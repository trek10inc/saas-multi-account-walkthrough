import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import * as fs from 'fs';

const ACCOUNTS_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? '';
const TEMP_FILE_PATH = 'temp/accounts.json';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function main() {
  try {
    if(!ACCOUNTS_TABLE_NAME) {
      throw new Error('DYNAMODB_TABLE_NAME environment variable is required');
    }
    const scanResult = await docClient.send(new ScanCommand({ 
      TableName: ACCOUNTS_TABLE_NAME,
      FilterExpression: 'attribute_exists(awsAccountId)',
    }));
    const accounts = scanResult.Items || [];
    const accountsJson = JSON.stringify(accounts, null, 2);

    if(!fs.existsSync('temp')) {
      fs.mkdirSync('temp');
    }

    fs.writeFileSync(TEMP_FILE_PATH, accountsJson, { encoding: 'utf-8' });

    console.log(`Wrote ${accounts.length} accounts to ${TEMP_FILE_PATH}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
