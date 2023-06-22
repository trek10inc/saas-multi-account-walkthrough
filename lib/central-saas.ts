import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import path = require('path');
import * as fs from 'fs';
import { Repository } from 'aws-cdk-lib/aws-codecommit';
import { ReleasePipelineStack } from './release-pipeline';
import { AccountData } from '../src/types';

export class CentralSaasStack extends cdk.Stack {

    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Create DynamoDB table
        const accountsDB = new dynamodb.Table(this, 'AccountsDB', {
            partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            stream: dynamodb.StreamViewType.NEW_IMAGE
        });
        new cdk.CfnOutput(this, "AccountsDBName", { value: accountsDB.tableName });

        accountsDB.addGlobalSecondaryIndex({
            indexName: 'CustomerNameIndex',
            partitionKey: { name: 'customerName', type: dynamodb.AttributeType.STRING },
        });

        const s3DataLake = new s3.Bucket(this, 'S3DataLake', { bucketName: `central-saas-${this.account}-${this.region}`, removalPolicy: cdk.RemovalPolicy.DESTROY });
        const datalakeLambda = new NodejsFunction(this, 'DatalakeLambda', {
            runtime: lambda.Runtime.NODEJS_14_X,
            entry: 'src/central-saas/functions/datalake/index.ts',
            handler: 'handler',
            environment: {
                S3Bucket: s3DataLake.bucketName
            }
        });
        s3DataLake.grantReadWrite(datalakeLambda);
        datalakeLambda.addEventSource(new eventsources.DynamoEventSource(accountsDB, {
            startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        }));

        new cdk.CfnOutput(this, "S3DataLakeBucket", { value: s3DataLake.bucketName });

        // Create Stepfunction, CodeCommit and CodeBuild Resources
        const codeRepo = new Repository(this, 'CodeRepo', {
            repositoryName: 'central-saas-repo',
        });
        new cdk.CfnOutput(this, "CodeRepoName", { value: codeRepo.repositoryName });

        if(!process.env.ACCOUNT_EMAIL_USER) {
            throw new Error('ACCOUNT_EMAIL_USER environment variable is not set');
        }
        if(!process.env.ACCOUNT_EMAIL_DOMAIN) {
            throw new Error('ACCOUNT_EMAIL_DOMAIN environment variable is not set');
        }
        const buildAccountLambda = new NodejsFunction(this, 'BuildAccountLambda', {
            runtime: lambda.Runtime.NODEJS_16_X,
            entry: 'src/central-saas/functions/workflow/buildAccount.ts',
            handler: 'handler',
            environment: {
                ACCOUNT_EMAIL_USER: process.env.ACCOUNT_EMAIL_USER,
                ACCOUNT_EMAIL_DOMAIN: process.env.ACCOUNT_EMAIL_DOMAIN,
                ACCOUNT_ROLE_NAME: process.env.ACCOUNT_ROLE_NAME ?? 'OrganizationAccountAccessRole',
                ACCOUNT_FACTORY_ORGANIZATION_UNIT_ID: process.env.ACCOUNT_FACTORY_ORGANIZATION_UNIT_NAME ?? 'Sandbox',
                ACCOUNT_FACTORY_PORTFOLIO_NAME: process.env.ACCOUNT_FACTORY_PORTFOLIO_NAME ?? 'AWS Control Tower Account Factory',
                DYNAMODB_TABLE_NAME: accountsDB.tableName
            },
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: [
                        '*',
                    ],
                    resources: [
                        `*`
                    ],
                })
            ],
            timeout: cdk.Duration.minutes(5),
        });
        accountsDB.grantReadWriteData(buildAccountLambda);
        
        // buildAccountLambda.role!.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSServiceCatalogAdminFullAccess'));
        // buildAccountLambda.role!.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCloudFormationFullAccess'));

        const handleAccountCreatedEvent = new NodejsFunction(this, 'HandleAccountCreatedEvent', {
            runtime: lambda.Runtime.NODEJS_16_X,
            entry: 'src/central-saas/functions/workflow/handleAccountCreatedEvent.ts',
            handler: 'handler',
            environment: {
                DYNAMODB_TABLE_NAME: accountsDB.tableName
            },
            timeout: cdk.Duration.seconds(30)
        });
        accountsDB.grantReadWriteData(handleAccountCreatedEvent);

        const accountCreatedEventRule = new events.Rule(this, 'AccountCreatedEventRule', {
            eventPattern: {
                detailType: ['AWS Service Event via CloudTrail'],
                detail: {
                    eventName: ['CreateManagedAccount'],
                    serviceEventDetails: {
                        createManagedAccountStatus: {
                            state: ['SUCCEEDED', 'FAILED']
                        }
                    }
                }
            }
        });
        accountCreatedEventRule.addTarget(new events_targets.LambdaFunction(handleAccountCreatedEvent, {
            event: events.RuleTargetInput.fromObject({
                awsAccountId: events.EventField.fromPath('$.detail.serviceEventDetails.createManagedAccountStatus.account.accountId'),
                accountName: events.EventField.fromPath('$.detail.serviceEventDetails.createManagedAccountStatus.account.accountName'),
                state: events.EventField.fromPath('$.detail.serviceEventDetails.createManagedAccountStatus.state')
            })
        }));

        const pipelineProvisionAccountBuild = new codebuild.Project(this, 'PipelineProvisionAccountCodeBuild', {
            source: codebuild.Source.codeCommit({
                repository: codeRepo,
                branchOrRef: 'main'
            }),
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspecs/buildspec-provision-account.yml'),
            environmentVariables: {
                CURRENT_AWS_ACCOUNT_ID: { value: this.account },
                ACCOUNT_EMAIL_USER: { value: process.env.ACCOUNT_EMAIL_USER ?? 'NO_VALUE' },
                ACCOUNT_EMAIL_DOMAIN: { value: process.env.ACCOUNT_EMAIL_DOMAIN ?? 'NO_VALUE' },
                ACCOUNT_ID: { value: 'NEEDS TO BE OVERWRITTEN by the build trigger' },
                AWS_ACCOUNT_ID: { value: 'NEEDS TO BE OVERWRITTEN by the build trigger' },
                ACCOUNT_ROLE_NAME: { value: process.env.ACCOUNT_ROLE_NAME ?? 'AWSControlTowerExecution' },
                DYNAMODB_TABLE_NAME: { value: accountsDB.tableName },
            },
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
                privileged: true,
            },
        });
        const awsControlTowerExecutionRole = iam.Role.fromRoleArn(this, 'AWSControlTowerExecutionRole', `arn:aws:iam::*:role/${process.env.ACCOUNT_ROLE_NAME ?? 'AWSControlTowerExecution'}`);
        awsControlTowerExecutionRole.grantAssumeRole(pipelineProvisionAccountBuild.role!);
        accountsDB.grantReadWriteData(pipelineProvisionAccountBuild);

        const pipelineCentralSaasCodeBuild = new codebuild.Project(this, 'PipelineCentralSaasCodeBuild', {
            source: codebuild.Source.codeCommit({
                repository: codeRepo,
                branchOrRef: 'main'
            }),
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspecs/buildspec-central.yml'),
            environmentVariables: {
                CURRENT_AWS_ACCOUNT_ID: { value: this.account },
                ACCOUNT_EMAIL_USER: { value: process.env.ACCOUNT_EMAIL_USER ?? 'NO_VALUE' },
                ACCOUNT_EMAIL_DOMAIN: { value: process.env.ACCOUNT_EMAIL_DOMAIN ?? 'NO_VALUE' },
                ACCOUNT_ID: { value: 'NEEDS TO BE OVERWRITTEN by the build trigger' },
                AWS_ACCOUNT_ID: { value: 'NEEDS TO BE OVERWRITTEN by the build trigger' },
                ACCOUNT_ROLE_NAME: { value: process.env.ACCOUNT_ROLE_NAME ?? 'AWSControlTowerExecution' },
                DYNAMODB_TABLE_NAME: { value: accountsDB.tableName },
            },
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
                privileged: true,
            },
        });
        pipelineCentralSaasCodeBuild.addToRolePolicy(new iam.PolicyStatement({
            actions: [ 
                'cloudformation:*',
                'servicecatalog:*',
                'organizations:*',
                'iam:*',
                'lambda:*',
                's3:*',
                'stepfunctions:*',
                'codepipeline:*',
                'codecommit:*',
                'codebuild:*',
                'quicksight:*',
                'athena:*',
                'glue:*',
                'sqs:*',
                'sts:assumeRole',
                'dynamodb:*',
            ],
            resources: [ '*' ]
        }));

        const pipelineUpdateCentralCodeBuild = new codebuild.Project(this, 'PipelineUpdateCentralCodeBuild', {
            source: codebuild.Source.codeCommit({
                repository: codeRepo,
                branchOrRef: 'main'
            }),
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspecs/buildspec-central.yml'),
            environmentVariables: {
                CURRENT_AWS_ACCOUNT_ID: { value: this.account },
                ACCOUNT_EMAIL_USER: { value: process.env.ACCOUNT_EMAIL_USER ?? 'NO_VALUE' },
                ACCOUNT_EMAIL_DOMAIN: { value: process.env.ACCOUNT_EMAIL_DOMAIN ?? 'NO_VALUE' },
                ACCOUNT_ID: { value: 'NEEDS TO BE OVERWRITTEN by the build trigger' },
                AWS_ACCOUNT_ID: { value: 'NEEDS TO BE OVERWRITTEN by the build trigger' },
                ACCOUNT_ROLE_NAME: { value: process.env.ACCOUNT_ROLE_NAME ?? 'AWSControlTowerExecution' },
                DYNAMODB_TABLE_NAME: { value: accountsDB.tableName },
            },
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
                privileged: true,
            },
        });

        //
        // Step Function
        //
        // Create step function role
        const stepFunctionPipelineRole = new iam.Role(this, 'StepFunctionPipelineRole', {
            assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
        });
        stepFunctionPipelineRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodePipeline_FullAccess'));
        buildAccountLambda.grantInvoke(stepFunctionPipelineRole);

        const buildAccountTask = new tasks.CallAwsService(this, 'BuildAccountTask', {
            service: 'lambda',
            action: 'invoke',
            integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
            iamResources: [stepFunctionPipelineRole.roleArn],
            parameters: {
                FunctionName: buildAccountLambda.functionArn,
                Payload: sfn.TaskInput.fromObject({
                    token: sfn.JsonPath.taskToken,
                    account: sfn.JsonPath.stringAt('$'),
                }),
            }
        });

        const pipelineProvisionAccountTask = new tasks.CodeBuildStartBuild(this, 'PipelineProvisionAccountBuildTask', {
            project: pipelineProvisionAccountBuild,
            integrationPattern: sfn.IntegrationPattern.RUN_JOB,
            environmentVariablesOverride: {
                AWS_ACCOUNT_ID: { value: sfn.JsonPath.stringAt('$.awsAccountId') },
                ACCOUNT_ID: { value: sfn.JsonPath.stringAt('$.accountId') },
            },
            resultPath: '$.build',
        });

        const pipelineCentralSaasCodeBuildTask = new tasks.CodeBuildStartBuild(this, 'PipelineCentralSaasBuildTask', {
            project: pipelineCentralSaasCodeBuild,
            integrationPattern: sfn.IntegrationPattern.RUN_JOB,
            environmentVariablesOverride: {
                AWS_ACCOUNT_ID: { value: sfn.JsonPath.stringAt('$.awsAccountId') },
                ACCOUNT_ID: { value: sfn.JsonPath.stringAt('$.accountId') },
            },
            resultPath: '$.build',
        });

        const releaseProductCodePipelineTask = new tasks.CallAwsService(
            this,
            'ReleaseProductCodePipelineTask',
            {
                service: 'codepipeline',
                action: 'startPipelineExecution',
                parameters: { 
                    Name: sfn.JsonPath.stringAt('$.pipelineName')
                },
                iamResources: [stepFunctionPipelineRole.roleArn],
            }
        );

        const accountCreateState = new sfn.StateMachine(this, 'AccountCreateStateMachine', {
            definition: buildAccountTask
                .next(pipelineProvisionAccountTask)
                .next(pipelineCentralSaasCodeBuildTask)
                .next(releaseProductCodePipelineTask),
            role: stepFunctionPipelineRole,
        });
        accountCreateState.grantTaskResponse(handleAccountCreatedEvent);

        //
        // Create API capabilities
        //
        const createAccountApiLambda = new NodejsFunction(this, 'CreateAccountApiLambda', {
            runtime: lambda.Runtime.NODEJS_16_X,
            entry: 'src/central-saas/functions/api/createAccountLambda.ts',
            handler: 'handler',
            environment: {
                ACCOUNTS_TABLE_NAME: accountsDB.tableName,
                ACCOUNT_CREATION_STATE_MACHINE_ARN: accountCreateState.stateMachineArn,
            }
        });
        accountsDB.grantReadWriteData(createAccountApiLambda);
        accountCreateState.grantStartExecution(createAccountApiLambda);

        // Create API Gateway
        const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
            logGroupName: '/aws/apigateway/management-api',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.ONE_DAY,
        });
        const api = new apigateway.LambdaRestApi(this, 'ManagementApi', {
            handler: createAccountApiLambda,
            endpointTypes: [apigateway.EndpointType.REGIONAL],
            deployOptions: {
                accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
            },
        });
        new cdk.CfnOutput(this, 'ManagementApiUrl', { value: api.url });

        // Create an API key
        const apiKey = new apigateway.ApiKey(this, 'ApiKey', {
            apiKeyName: 'management-api-key',
            enabled: true,
        });
        new cdk.CfnOutput(this, 'ManagementApiKey', { value: apiKey.keyId });

        // Create Method and Model Validation
        const createAccountEventModel = api.addModel('CreateAccountEvent', {
            contentType: 'application/json',
            modelName: 'CreateAccountEvent',
            schema: {
                schema: apigateway.JsonSchemaVersion.DRAFT4,
                title: 'CreateAccountEvent',
                type: apigateway.JsonSchemaType.OBJECT,
                properties: {
                    accountId: { type: apigateway.JsonSchemaType.STRING },
                    customerName: { type: apigateway.JsonSchemaType.STRING },
                    expiration: { type: apigateway.JsonSchemaType.STRING },
                    products: {
                        type: apigateway.JsonSchemaType.ARRAY,
                        items: {
                            type: apigateway.JsonSchemaType.OBJECT,
                            properties: {
                                name: { type: apigateway.JsonSchemaType.STRING },
                                version: { type: apigateway.JsonSchemaType.STRING },
                            },
                            required: ['name', 'version']
                        }
                    },
                    adminEmails: {
                        type: apigateway.JsonSchemaType.ARRAY,
                        items: { type: apigateway.JsonSchemaType.STRING },
                    },
                },
                required: ['customerName', 'expiration', 'products', 'adminEmails'],
            },
        });
        const method = new apigateway.Method(this, 'ApiMethod', {
            httpMethod: "PUT",
            resource: api.root,
            options: {
                apiKeyRequired: true,
                methodResponses: [
                    {
                        statusCode: '200'
                    },
                    {
                        statusCode: '400'
                    },
                    {
                        statusCode: '500'
                    }
                ],
                requestModels: {
                    'application/json': createAccountEventModel,
                },
                requestValidator: new apigateway.RequestValidator(this, 'RequestValidator', {
                    restApi: api,
                    validateRequestBody: true,
                    validateRequestParameters: true,
                })
            },
        });

        // Create a usage plan
        const usagePlan = new apigateway.UsagePlan(this, 'UsagePlan', {
            name: 'management-api-usage-plan',
            throttle: {
                burstLimit: 10,
                rateLimit: 2,
            }
        });
        usagePlan.addApiKey(apiKey);
        usagePlan.addApiStage({ stage: api.deploymentStage });


        //
        // Create pipelines for accounts
        //
        const accountData: AccountData[] = fs.existsSync('../temp/accounts.json')? JSON.parse(fs.readFileSync(path.join(__dirname, '../temp/accounts.json'), 'utf8')) : [];

        console.log('Known Accounts', accountData.length);
        const productToRepoMap: { [key: string]: Repository } = {
            webapp: codeRepo
        };
        accountData.forEach(account => {
            account.products.forEach(product => {
                new ReleasePipelineStack(this, `ReleasePipelineStack-${account.accountId}`, {
                    ...account,
                    awsAccountId: account.awsAccountId!,
                    accountName: account.customerName,
                    repository: productToRepoMap[product.name],
                    release: product.version,
                    accountsDB
                });    
            });
        });
    }
}
