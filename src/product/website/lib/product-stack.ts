import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as fs from 'fs';

export class ProductStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create an S3 bucket for hosting the website
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: true,
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production
    });

    // Create a CloudFront distribution for the website
    // const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OriginAccessIdentity');
    // const distribution = new cloudfront.Distribution(this, 'WebsiteDistribution', {
    //   defaultBehavior: { origin: new origins.S3Origin(websiteBucket, { originAccessIdentity: originAccessIdentity }) },
    //   defaultRootObject: 'index.html',
    // });

    // websiteBucket.grantRead(originAccessIdentity);

    if(fs.existsSync('./build')) {
      // Deploy the React SPA to the S3 bucket
      new s3deploy.BucketDeployment(this, 'DeployReactSPA', {
          sources: [s3deploy.Source.asset('./build')], // Update the path to your React SPA build directory
          destinationBucket: websiteBucket,
          // distribution: distribution,
          // distributionPaths: ['/*'],
      });
    }
    new cdk.CfnOutput(this, "WebsiteUrl", { value: websiteBucket.bucketWebsiteUrl });
  }
}
