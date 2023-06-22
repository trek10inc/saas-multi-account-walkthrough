import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { unmarshall } from "@aws-sdk/util-dynamodb";

// Creating new S3 client
const s3 = new S3Client({ });

exports.handler = async (event: DynamoDBStreamEvent) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    // Iterate over each record in the batch
    for (let i = 0; i < event.Records.length; i++) {
        const record: DynamoDBRecord = event.Records[i];

        // If there is a dynamodb record, unmarshall it
        if (record.dynamodb && record.dynamodb.NewImage) {
            const unmarshalledRecord = unmarshall(record.dynamodb.NewImage);

            // Convert the record to a string and write it to the S3 bucket
            const params = {
                Bucket: process.env.S3Bucket,  // Name of your S3 bucket
                Key: `accounts/${record.eventID}.json`,  // Use the event ID as the name of the file
                Body: JSON.stringify(unmarshalledRecord),  // Stringified unmarshalled record data
                ContentType: 'application/json'
            };

            try {
                const putObject = new PutObjectCommand(params);
                await s3.send(putObject);
                console.log(`Successfully uploaded data to ${process.env.S3Bucket}/${record.eventID}`);
            } catch (err) {
                console.error(err, 'Error uploading to S3');
            }
        }
    }
};
