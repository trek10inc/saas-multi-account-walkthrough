import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctions_tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as aws_sns from 'aws-cdk-lib/aws-sns';
import * as aws_sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';

import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct, Node } from 'constructs';

const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || '';

interface ReleasePipelineProps extends cdk.StackProps {
    repository: codecommit.IRepository;
    release: string;
    lastUpdated: string;
    accountId: string;
    accountName: string;
    awsAccountId: string;
    accountsDB: dynamodb.ITable;
}

class CrossAccountRole implements iam.IRole {
    private privateRole: iam.IRole;

    roleArn: string;
    roleName: string;
    grant(grantee: cdk.aws_iam.IPrincipal, ...actions: string[]): cdk.aws_iam.Grant {
        // Ignore as we are assuming a cross account role
        return cdk.aws_iam.Grant.addToPrincipal({
            grantee,
            resourceArns: [this.roleArn],
            actions: ['sts:AssumeRole']
        });
    }
    grantPassRole(grantee: cdk.aws_iam.IPrincipal): cdk.aws_iam.Grant {
        // Ignore as we are assuming a cross account role
        return cdk.aws_iam.Grant.addToPrincipal({
            grantee,
            resourceArns: [this.roleArn],
            actions: ['sts:PassRole']
        });
    }
    grantAssumeRole(grantee: cdk.aws_iam.IPrincipal): cdk.aws_iam.Grant {
        // Ignore as we are assuming a cross account role
        return cdk.aws_iam.Grant.addToPrincipal({
            grantee,
            resourceArns: [this.roleArn],
            actions: ['sts:AssumeRole']
        });
    }
    grantExecuteChangeSet(policy: cdk.aws_iam.Policy): void {
        // Ignore as we are assuming a cross account role
    }

    attachInlinePolicy(policy: cdk.aws_iam.Policy): void {
        // Ignore as we are assuming a cross account role
    }
    addManagedPolicy(policy: cdk.aws_iam.IManagedPolicy): void {
        // Ignore as we are assuming a cross account role
    }

    addToPolicy() {
        // Ignore as we are assuming a cross account role
    }

    assumeRoleAction: string;
    policyFragment: cdk.aws_iam.PrincipalPolicyFragment;
    principalAccount?: string | undefined;
    addToPrincipalPolicy(statement: cdk.aws_iam.PolicyStatement): cdk.aws_iam.AddToPrincipalPolicyResult {
        // Ignore as we are assuming a cross account role
        return { statementAdded: false, policyDependable: { dependencyElements: [] } };
    }
    grantPrincipal: cdk.aws_iam.IPrincipal;
    stack: cdk.Stack;
    env: cdk.ResourceEnvironment;
    applyRemovalPolicy(policy: cdk.RemovalPolicy): void {
        // Ignore as we are assuming a cross account role
    }
    node: Node;

    constructor(scope: Construct, id: string, props: { currentAccount: string, roleArn: string }) {
        this.roleArn = props.roleArn;
        this.roleName = props.roleArn.split('/')[1];
        this.assumeRoleAction = 'sts:AssumeRole';
        this.principalAccount = props.roleArn.split(':')[4];

        this.privateRole = new iam.Role(scope, id, { assumedBy: new iam.AccountPrincipal(props.currentAccount) });

        this.grantPrincipal = new iam.AccountPrincipal(props.currentAccount);
        this.env = {
            account: this.principalAccount,
            region: cdk.Stack.of(scope).region
        }
        this.stack = scope as cdk.Stack;
        this.node = this.privateRole.node;
    }
}

//
// This stack automates the release process of a React website by creating a pipeline that fetches code, 
// builds the website, executes infrastructure changes, and performs custom logic. It utilizes various AWS services 
// like CodeCommit, CodeBuild, CloudFormation, Lambda, and SSM to streamline the deployment workflow and ensure 
// consistent releases.
//
export class ReleasePipelineStack extends cdk.NestedStack {
    constructor(scope: Construct, id: string, props: ReleasePipelineProps) {
        super(scope, id, props);

        //
        // The code starts by setting up a CodeBuild project, which is a service that 
        // compiles and builds the React website. It specifies the build steps in the 
        // buildSpec, such as installing project dependencies and running the build script. 
        // The project uses the npm ci command to install dependencies and npm run build to 
        // build the website.
        //
        const buildProject = new codebuild.PipelineProject(this, 'ReactWebsiteBuild', {
            projectName: `${props.accountName}-release-build`,
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspecs/buildspec-react-website.yml'),
            environmentVariables: {
                CURRENT_AWS_ACCOUNT_ID: { value: this.account },
                ACCOUNT_ID: { value: props.accountId },
                AWS_ACCOUNT_ID: { value: props.awsAccountId },
                ACCOUNT_ROLE_NAME: { value: 'AWSControlTowerExecution' },
                DYNAMODB_TABLE_NAME: { value: props.accountsDB.tableName },
                CURRENT_BRANCH: { value: props.release },
            },
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
                privileged: true,
            },
        });
        buildProject.addToRolePolicy(new iam.PolicyStatement({
            actions: ['sts:AssumeRole'],
            resources: [`arn:aws:iam::${props.awsAccountId}:role/AWSControlTowerExecution`],
        }));

        // Create a pipeline for the release process
        const pipeline = new codepipeline.Pipeline(this, 'ReleaseCodePipeline', {
            pipelineName: `${props.accountName}-pipeline`,
            restartExecutionOnUpdate: true,
        });
        pipeline.addToRolePolicy(new iam.PolicyStatement({
            actions: ['sts:AssumeRole'],
            resources: [`arn:aws:iam::${props.awsAccountId}:role/AWSControlTowerExecution`],
        }));

        //
        // Next, the code defines a pipeline that orchestrates the different stages of the release 
        // process. The pipeline consists of two stages: "Source" and "Build". The "Source" stage fetches 
        // the code from a CodeCommit repository, while the "Build" stage triggers the previously defined 
        // CodeBuild project to build the React website.
        //
        const sourceArtifact = new codepipeline.Artifact('SourceOutput');
        // Add the source stage
        pipeline.addStage({
            stageName: 'Source',
            actions: [
                new codepipeline_actions.CodeCommitSourceAction({
                    actionName: 'CodeCommit',
                    repository: props.repository,
                    branch: props.release,
                    output: sourceArtifact,
                }),
            ],
        });

        const buildArtifact = new codepipeline.Artifact('BuildOutput');
        // Add the build stage
        pipeline.addStage({
            stageName: 'Build',
            actions: [
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'CodeBuild',
                    project: buildProject,
                    input: sourceArtifact,
                    outputs: [buildArtifact],
                }),
            ],
        });

        //
        // The following code will automatically approve deployments at the scheduled maintanance window.
        //
        const approvalTopic = new aws_sns.Topic(this, 'ApprovalTopic');

        const scheduleReleaseLambda = new NodejsFunction(this, 'ScheduleReleaseLambda', {
            runtime: lambda.Runtime.NODEJS_14_X,
            handler: 'handler',
            entry: 'src/central-saas/functions/schedule-release/index.ts',
            environment: {
                DEPLOYMENT_WINDOW: process.env.DEPLOYMENT_WINDOW || '00:00',
            },
        });
        const approveAtMidnightStateMachine = new stepfunctions.StateMachine(this, 'ApproveAtMidnight', {
            definition: new stepfunctions_tasks.LambdaInvoke(this, 'CalculateWaitTime', {
                lambdaFunction: scheduleReleaseLambda,
                outputPath: '$.Payload',
            }).next(new stepfunctions.Wait(this, 'WaitUntilDeploymentWindow', {
                time: stepfunctions.WaitTime.secondsPath('$.timeUntilNextDeploymentWindowSeconds'),
            })).next(new stepfunctions_tasks.CallAwsService(this, 'ApproveManualAction', {
                service: 'codepipeline',
                action: 'putApprovalResult',
                parameters: {
                    PipelineName: pipeline.pipelineName,
                    StageName: 'ApprovalStage',
                    ActionName: 'ManualApproval',
                    Result: {
                        Summary: 'Automatically approved at midnight',
                        Status: 'Approved',
                    },
                    Token: '$.token'
                },
                iamResources: [pipeline.pipelineArn]
            })),
        });
        const approveAtMidnightRule = new events.Rule(this, 'ApproveAtMidnightRule', {
            eventPattern: {
                source: ['aws.sns'],
                detailType: ['AWS API Call via CloudTrail'],
                detail: {
                    eventName: ['Publish'],
                    requestParameters: {
                        topicArn: [approvalTopic.topicArn],
                    },
                },
            },
        });
        approveAtMidnightRule.addTarget(new events_targets.SfnStateMachine(approveAtMidnightStateMachine));

        pipeline.addStage({
            stageName: 'ApprovalStage',
            actions: [
                new codepipeline_actions.ManualApprovalAction({
                    actionName: 'ManualApproval',
                    additionalInformation: 'Please approve this action.',
                    notificationTopic: approvalTopic,
                    runOrder: 2,
                }),
            ],
        });

        //
        // Next, the code defines a pipeline that orchestrates the different stages 
        // of the release process. The pipeline consists of two stages: "Source" and 
        // "Build". The "Source" stage fetches the code from a CodeCommit repository, 
        // while the "Build" stage triggers the previously defined CodeBuild project 
        // to build the React website.
        //
        console.log('updateVersionInfo');
        const updateDynamoDBLambda = new NodejsFunction(this, 'UpdateDynamoDBLambda', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: 'src/central-saas/functions/release-pipeline/updateVersionInfo.ts',
        });
        
        pipeline.addStage({
            stageName: 'ExecuteChangeSet',
            actions: [
                new codepipeline_actions.CloudFormationExecuteChangeSetAction({
                    actionName: 'ExecuteChangeSet',
                    stackName: 'ProductStack', // Replace this with the stack name you want to update
                    changeSetName: 'cdk-deploy-change-set', // Replace this with the change set name you want to execute
                    runOrder: 1,
                    role: new CrossAccountRole(this, 'CrossAccountRole', { currentAccount: this.account, roleArn: `arn:aws:iam::${props.awsAccountId}:role/AWSControlTowerExecution` })
                })
            ],
        });


        //
        // To facilitate cross-account access and integration securely, the code creates two 
        // AWS SSM (Systems Manager) StringParameters. These parameters store the role ARNs required 
        // for the release pipeline and build project. They can be referenced by other components in the 
        // system for role assumption and access control.
        // 
        const accountIdClean = props.awsAccountId.replace(/-/g, '');
        new ssm.StringParameter(this, 'PipelineRole', {
            parameterName: `/account/${accountIdClean}/saas-pipeline/role`,
            stringValue: pipeline.role.roleArn,
        });

        new ssm.StringParameter(this, 'BuildRole', {
            parameterName: `/account/${accountIdClean}/saas-build/role`,
            stringValue: buildProject.role!.roleArn,
        });
    }
}
