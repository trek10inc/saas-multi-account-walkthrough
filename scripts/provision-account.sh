##
## Deploy the cross account roles
##
if [ -z "$AWS_ACCOUNT_ID" ]; then
  echo "ACCOUNT_NAME is not set skipping cross account role creation"
else
    echo "Get the roles for the pipeline and build services"
    export DEPLOY_ROLE_ARN="arn:aws:iam::$CURRENT_AWS_ACCOUNT_ID:role/CentralSaaSStack-*"
    export BUILD_ROLE_ARN="arn:aws:iam::$CURRENT_AWS_ACCOUNT_ID:role/CentralSaaSStack-*"

    echo "Deploying CDK bootstrapping resources"
    cdk bootstrap

    echo "Applied cross account role to account"
fi
