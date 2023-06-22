import * as cdk from 'aws-cdk-lib';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as servicecatalog from 'aws-cdk-lib/aws-servicecatalog';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class ServiceCatalogStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Upload the CloudFormation template to an S3 bucket
    const asset = new s3assets.Asset(this, 'CfnTemplateAsset', {
      path: 'cf-cross-account-roles.yml'
    });

    // Create a Service Catalog product
    const product = new servicecatalog.CfnCloudFormationProduct(this, 'ServiceCatalogProduct', {
      name: 'CrossAccountRoleProduct',
      owner: 'YourOrganizationName',
      description: 'This creates the cross account roles which will be used to deploy updates to this account',
      provisioningArtifactParameters: [{
        info: {
          LoadTemplateFromURL: asset.httpUrl,
        },
        name: 'v1.0',
      }]
    });

    // Create a Parameter Store parameter for the product ID
    new ssm.StringParameter(this, 'ProductIdParameter', {
        parameterName: '/servicecatalog/product/name',
        stringValue: product.attrProductName,
      });
  
      // Create a Parameter Store parameter for the asset ID
      new ssm.StringParameter(this, 'AssetIdParameter', {
        parameterName: '/servicecatalog/artifact/name',
        stringValue: product.attrProvisioningArtifactNames,
      });
  }
}
