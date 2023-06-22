import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AccountData } from '../../../types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const stepfunctions = new SFNClient({});

const accountsDBTable = process.env.ACCOUNTS_TABLE_NAME ?? 'CentralSaaSStack-AccountsDBF51D9586-RNMOWSI5CRA1';
const eventSource = process.env.EVENT_SOURCE ?? 'custom.accountCreation';

export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
  console.log(JSON.stringify(event));
  const { accountId, customerName, expiration, adminEmails, products } = JSON.parse(event.body!.toString()) as AccountData;
  
  const input: AccountData = {
    accountId,
    products,
    customerName,
    expiration,
    adminEmails,
    accountStatus: 'INITIATING',
    lastUpdated: new Date().toISOString(),
  };

  if(accountId) {
    return await handleAccountIdPresent(input);
  }

  return await handleNewAccountCreation(input);
}

async function handleNewAccountCreation(input: AccountData): Promise<APIGatewayProxyResult> {
  if(await queryAccountByName(input)) {
    return { statusCode: 409, body: 'Account with name already exists' };
  }

  // Generate a unique accountId
  input.accountId = uuidv4();
  const date = new Date();
  input.lastUpdated = date.toISOString();

  // Store Account Information in DynamoDB
  const putItemInput = new PutCommand({
    TableName: accountsDBTable,
    Item: input,
  });
  
  try {
    console.log('putting data in dynamo', JSON.stringify(putItemInput.input));
    await ddb.send(putItemInput);
    console.log('put item complete');
  } catch (error) {
    console.error('Error storing account information:', error);
    return { statusCode: 500, body: 'Error storing account information' };
  }

  try {
    console.log('Starting step function');
    await stepfunctions.send(new StartExecutionCommand({
      stateMachineArn: process.env.ACCOUNT_CREATION_STATE_MACHINE_ARN ?? '',
      input: JSON.stringify(input),
      name: input.accountId + '-' + date.getTime(),
    }));

    console.log('event sent');
  } catch (error) {
    console.error('Error sending account creation notification:', error);
    return { statusCode: 500, body: 'Error sending account creation notification' };
  }

  return { statusCode: 200, body: JSON.stringify({ status: 'Account creation started successfully', accountId: input.accountId })};
}

async function queryAccountByName(input: AccountData) {
  console.log('Querying for account by name');
  const queryResult = await ddb.send(new QueryCommand({
    TableName: accountsDBTable,
    IndexName: 'CustomerNameIndex',
    KeyConditionExpression: 'customerName = :customerName',
    ExpressionAttributeValues: {
      ':customerName': input.customerName
    }
  }));

  if(queryResult?.Items?.length) {
    console.log('Account with name found');
    return queryResult.Items[0]  as AccountData;
  }
  return;
}

async function handleAccountIdPresent(input: AccountData): Promise<APIGatewayProxyResult> {
  let existing: AccountData | undefined = undefined;

  console.log('Acting on the accountId', input.accountId);
  const result = await ddb.send(new GetCommand({ TableName: accountsDBTable, Key: { accountId: input.accountId } }));
  if(result?.Item) {
    console.log('Found existing account from get');
    existing = result.Item as AccountData;
  }

  if(!existing) {
    console.log('Account not found');
    return { statusCode: 404, body: 'Account not found' };
  }

  const date = new Date();
  input.accountId = existing.accountId;
  input.awsAccountId = existing.awsAccountId;
  input.awsServiceCatalog = existing.awsServiceCatalog;
  input.accountStatus = existing.accountStatus;
  input.lastUpdated = date.toISOString();

  console.log('Updating account');
  await ddb.send(new UpdateCommand({
    TableName: accountsDBTable,
    Key: { accountId: input.accountId },
    UpdateExpression: 'set #products = :products, #expiration = :expiration, #adminEmails = :adminEmails, lastUpdated = :lastUpdated',
    ExpressionAttributeNames: {
      '#products': 'products',
      '#expiration': 'expiration',
      '#adminEmails': 'adminEmails',
    },
    ExpressionAttributeValues: {
      ':products': input.products,
      ':expiration': input.expiration,
      ':adminEmails': input.adminEmails,
      ':lastUpdated': input.lastUpdated,
    }
  }));

  // Send Account Update Notification to EventBridge

  try {
    console.log('Starting step function');
    await stepfunctions.send(new StartExecutionCommand({
      stateMachineArn: process.env.ACCOUNT_CREATION_STATE_MACHINE_ARN ?? '',
      input: JSON.stringify(input),
      name: input.accountId + '-' + date.getTime(),
    }));

    console.log('event sent');
  } catch (error) {
    console.error('Error sending account creation notification:', error);
    return { statusCode: 500, body: 'Error sending account creation notification' };
  }

  return { statusCode: 200, body: JSON.stringify({ status: 'Account updated successfully', accoutId: input.accountId })};
}
