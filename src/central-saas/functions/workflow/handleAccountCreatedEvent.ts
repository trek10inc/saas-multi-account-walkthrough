import { Context } from 'aws-lambda';
import { AccountData } from '../../../types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, SendTaskFailureCommand, SendTaskSuccessCommand, StartExecutionCommand } from '@aws-sdk/client-sfn';


const ACCOUNTS_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const stepFunction = new SFNClient({});

export async function handler(event: { awsAccountId: string, accountName: string, state: string}, context: Context) {
    console.log('Received event', JSON.stringify(event));
    const dbResult = await ddb.send(new QueryCommand({
        TableName: ACCOUNTS_TABLE_NAME,
        IndexName: 'CustomerNameIndex',
        KeyConditionExpression: '#customerName = :customerName',
        ExpressionAttributeNames: { '#customerName': 'customerName' },
        ExpressionAttributeValues: { ':customerName': event.accountName }
    }));

    if(dbResult.Items?.length !== 1) {
        throw new Error(`Expected to find 1 account with customer name ${event.accountName}, but found ${dbResult.Items?.length}`);
    }

    const account = dbResult.Items[0] as AccountData;
    if(!account.awsServiceCatalog?.stepFunctionToken) {
        throw new Error('Account missing awsServiceCatalog or stepFunctionToken');
    }
    account.pipelineName = event.accountName + '-pipeline';

    if(event.state == 'SUCCEEDED') {
        account.awsAccountId = event.awsAccountId;
        await ddb.send(new UpdateCommand({
            TableName: ACCOUNTS_TABLE_NAME,
            Key: { accountId: account.accountId },
            UpdateExpression: 'set #awsAccountId = :awsAccountId, #accountStatus = :accountStatus',
            ExpressionAttributeNames: { '#awsAccountId': 'awsAccountId' , '#accountStatus': 'accountStatus' },
            ExpressionAttributeValues: { ':awsAccountId': event.awsAccountId, ':accountStatus': 'ACCOUNT_CREATED' }
        }));
        
        account.awsAccountId = event.awsAccountId;
        account.accountStatus = 'ACCOUNT_CREATED';

        await stepFunction.send(new SendTaskSuccessCommand({
            taskToken: account.awsServiceCatalog.stepFunctionToken,
            output: JSON.stringify(account)
        }));
    } else {
        await stepFunction.send(new SendTaskFailureCommand({
            taskToken: account.awsServiceCatalog.stepFunctionToken,
            error: 'AccountCreationFailed',
            cause: 'Account creation failed'
        }));
    }

    return account;
};
