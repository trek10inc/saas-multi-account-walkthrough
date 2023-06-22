import * as AWS from 'aws-sdk';
import { AccountData } from '../src/types';

const ACCOUNTS_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? '';
const PROVISIONED_PRODUCT_ID = process.env.PROVISIONED_PRODUCT_ID ?? '';
const CREATED_TIME = process.env.CREATED_TIME ?? '';
const ACCOUNT_ID = process.env.ACCOUNT_ID ?? '';
const ACCOUNT_NAME = process.env.ACCOUNT_NAME ?? '';
const ACCOUNT_EMAIL_DOMAIN = process.env.ACCOUNT_EMAIL_DOMAIN ?? '';
const ACCOUNT_EMAIL_USER = process.env.ACCOUNT_EMAIL_USER ?? '';
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID ?? '';

const TEMP_FILE_PATH = 'temp/accounts.json';

const ddb = new AWS.DynamoDB.DocumentClient();
const serviceCatalog = new AWS.ServiceCatalog();

async function main() {
    if (!ACCOUNT_NAME) {
        console.error('Account name is required');
        process.exit(1);
        return;
    }
    try {
        let accountData: AccountData | undefined;
        const getResult = await ddb.get({ TableName: ACCOUNTS_TABLE_NAME, Key: { accountId: ACCOUNT_ID } }).promise();
        if (getResult.Item) {
            accountData = getResult.Item as AccountData;
        } else {
            const queryResult = await ddb.query({ TableName: ACCOUNTS_TABLE_NAME, IndexName: 'CustomerNameIndex', KeyConditionExpression: 'customerName = :customerName', ExpressionAttributeValues: { ':accountId': ACCOUNT_NAME } }).promise();
            if (queryResult?.Items?.length) {
                accountData = queryResult.Items[0] as AccountData;
            }
        }

        if (!accountData) {
            console.error('Account not found');
            process.exit(1);
            return;
        }

        if(!accountData.customerName) {
            console.log('Adding aws info to account');
            await ddb.update({
                TableName: ACCOUNTS_TABLE_NAME,
                Key: { accountId: ACCOUNT_ID },
                UpdateExpression: 'set #accountStatus = :accountStatus, #awsAccountId = :awsAccountId',
                ExpressionAttributeNames: { '#accountStatus': 'accountStatus', '#awsAccountId': 'awsAccountId' },
                ExpressionAttributeValues: { ':accountStatus': 'AVAILABLE', ':awsAccountId': AWS_ACCOUNT_ID }
            }).promise();
            console.log('Account updated');
        } else if (accountData.customerName !== ACCOUNT_NAME && accountData.awsAccountId) {
            console.log('Updating account name on already provisioned product');
            await serviceCatalog.updateProvisionedProductProperties({
                IdempotencyToken: CREATED_TIME,
                ProvisionedProductId: PROVISIONED_PRODUCT_ID,
                ProvisionedProductProperties: {
                    AccountEmail: `${ACCOUNT_EMAIL_USER}+${ACCOUNT_NAME}@${ACCOUNT_EMAIL_DOMAIN}}`,
                    AccountName: ACCOUNT_NAME
                }
            }).promise();

            await ddb.update({
                TableName: ACCOUNTS_TABLE_NAME,
                Key: { accountId: ACCOUNT_ID },
                UpdateExpression: 'set #customerName = :customerName',
                ExpressionAttributeNames: { '#customerName': 'customerName' },
                ExpressionAttributeValues: { ':customerName': ACCOUNT_NAME }
            }).promise();
        } else {
            console.log('The account status is unknown and cannot be acted on');
            process.exit(1);
            return;
        }

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
