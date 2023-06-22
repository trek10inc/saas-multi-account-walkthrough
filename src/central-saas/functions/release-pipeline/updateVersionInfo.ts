import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, UpdateCommandInput } from '@aws-sdk/lib-dynamodb';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDB({}));

interface UpdateVersionInfoEvent {
  accountId: string;
  versionNumber: string;
}

export const handler = async (event: UpdateVersionInfoEvent) => {
  const { accountId, versionNumber } = event;

  const params: UpdateCommandInput = {
    TableName: process.env.DYNAMODB_TABLE_NAME!,
    Key: { accountId },
    UpdateExpression: 'set #version = :version',
    ExpressionAttributeNames: {
      '#version': 'version',
    },
    ExpressionAttributeValues: {
      ':version': versionNumber,
    },
  };

  try {
    await dynamodb.send(new UpdateCommand(params));
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'DynamoDB updated successfully' }),
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error updating DynamoDB' }),
    };
  }
};
