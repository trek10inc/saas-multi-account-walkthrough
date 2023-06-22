import { Context } from 'aws-lambda';
import { AccountData, AsyncAccountData, StepFunctionEvent } from '../../../types';

import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, SendTaskFailureCommand, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { ProvisionProductCommand, ServiceCatalogClient, UpdateProvisionedProductCommand } from '@aws-sdk/client-service-catalog'

const ddb = DynamoDBDocumentClient.from(new DynamoDB({}));
const stepfunctions = new SFNClient({});
const serviceCatalog = new ServiceCatalogClient({});

const ACCOUNTS_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? '';
const ACCOUNT_EMAIL_DOMAIN = process.env.ACCOUNT_EMAIL_DOMAIN ?? '';
const ACCOUNT_EMAIL_USER = process.env.ACCOUNT_EMAIL_USER ?? '';
const ACCOUNT_FACTORY_PORTFOLIO_NAME = process.env.ACCOUNT_FACTORY_PORTFOLIO_NAME ?? '';

export async function handler(eventArgs: StepFunctionEvent<AsyncAccountData>, context: Context) {
    const event = eventArgs.value;
    console.log('Received event', JSON.stringify(event));
    
    try {
        if(!event.account.awsAccountId) {
            await handleNoAwsAccountId(event);
        } else if(event.account.awsServiceCatalog) {
            await handleUpdateExistingAccount(event);
        } else {
            throw new Error('Account is not in a state that can be updated');
        }

        return event.account;
    } catch (err: any) {
        console.error(err);
        await stepfunctions.send(new SendTaskFailureCommand({
            taskToken: event.token,
            error: err.message,
            cause: err.toString()
        }));
        throw err;
    }
};

async function handleUpdateExistingAccount(event: AsyncAccountData) {
    const existingAccountResponse = await ddb.send(new GetCommand({
        TableName: ACCOUNTS_TABLE_NAME,
        Key: { accountId: event.account.accountId }
    }));
    const existingAccount = existingAccountResponse.Item as AccountData;

    if(existingAccount.customerName !== event.account.customerName) {
        console.log('Updating account name on already provisioned product');
        await serviceCatalog.send(new UpdateProvisionedProductCommand({
            UpdateToken: event.account.lastUpdated,
            ProvisionedProductId: event.account.awsServiceCatalog!.id!,
            ProvisioningParameters: [
                { Key: 'AccountEmail', Value: `${ACCOUNT_EMAIL_USER}+${event.account.customerName}@${ACCOUNT_EMAIL_DOMAIN}}` },
                { Key: 'AccountName', Value: event.account.customerName },

                { Key: 'SSOUserFirstName', UsePreviousValue: true },
                { Key: 'SSOUserLastName', UsePreviousValue: true },
                { Key: 'SSOUserEmail', UsePreviousValue: true },
                { Key: 'ManagedOrganizationalUnit', UsePreviousValue: true }
            ]
        }));

        console.log('Updating account name in database');
        await ddb.send(new UpdateCommand({
            TableName: ACCOUNTS_TABLE_NAME,
            Key: { accountId: event.account.accountId },
            UpdateExpression: 'set #customerName = :customerName',
            ExpressionAttributeNames: { '#customerName': 'customerName' },
            ExpressionAttributeValues: { ':customerName': event.account.customerName }
        }));
        console.log('Account updated');
    } else {
        event.account.pipelineName = `${event.account.customerName}-pipeline`
        await stepfunctions.send(new SendTaskSuccessCommand({
            taskToken: event.token,
            output: JSON.stringify(event.account)
        }));
    }
}

async function handleNoAwsAccountId(event: AsyncAccountData) {
    console.log('Start creating aws account');
    const result = await serviceCatalog.send(new ProvisionProductCommand({
        ProductName: ACCOUNT_FACTORY_PORTFOLIO_NAME,
        ProvisioningArtifactName: 'AWS Control Tower Account Factory',
        ProvisionedProductName: event.account.customerName,
        ProvisioningParameters: [
            { Key: 'AccountName', Value: event.account.customerName },
            { Key: 'AccountEmail', Value: `${ACCOUNT_EMAIL_USER}+${event.account.customerName}@${ACCOUNT_EMAIL_DOMAIN}` },
            { Key: 'SSOUserFirstName', Value: 'System' },
            { Key: 'SSOUserLastName', Value: 'Admin' },
            { Key: 'SSOUserEmail', Value: `${ACCOUNT_EMAIL_USER}@${ACCOUNT_EMAIL_DOMAIN}` },
            { Key: 'ManagedOrganizationalUnit', Value: 'Sandbox' }
        ],
        ProvisionToken: event.account.lastUpdated.replace(/[\:\W]/g, '-')
    }));
    
    event.account.awsServiceCatalog = {
        id: result.RecordDetail!.ProvisionedProductId!,
        stepFunctionToken: event.token
    };
    console.log('Account creation started', event.account.awsServiceCatalog.id);

    await ddb.send(new UpdateCommand({
        TableName: ACCOUNTS_TABLE_NAME,
        Key: { accountId: event.account.accountId },
        UpdateExpression: 'set #awsServiceCatalog = :awsServiceCatalog',
        ExpressionAttributeNames: { '#awsServiceCatalog': 'awsServiceCatalog' },
        ExpressionAttributeValues: { ':awsServiceCatalog': event.account.awsServiceCatalog }
    }));
}
