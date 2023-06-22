if [ "$1" = "Connect" ]; then
    echo "Assume cross account role"
    ACCOUNT_ROLE_DETAILS=$(aws sts assume-role --role-arn arn:aws:iam::${AWS_ACCOUNT_ID}:role/$ACCOUNT_ROLE_NAME --role-session-name "AccountFactory" --no-cli-pager --output json)

    OLD_AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
    OLD_AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
    OLD_AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN

    aws sts get-caller-identity
    export AWS_ACCESS_KEY_ID=$(echo $ACCOUNT_ROLE_DETAILS | jq -r ".Credentials.AccessKeyId")
    export AWS_SECRET_ACCESS_KEY=$(echo $ACCOUNT_ROLE_DETAILS | jq -r ".Credentials.SecretAccessKey")
    export AWS_SESSION_TOKEN=$(echo $ACCOUNT_ROLE_DETAILS | jq -r ".Credentials.SessionToken")
    aws sts get-caller-identity
fi

if [ "$1" = "Disconnect" ]; then
    aws sts get-caller-identity
    export AWS_ACCESS_KEY_ID=$OLD_AWS_ACCESS_KEY_ID
    export AWS_SECRET_ACCESS_KEY=$OLD_AWS_SECRET_ACCESS_KEY
    export AWS_SESSION_TOKEN=$OLD_AWS_SESSION_TOKEN
    aws sts get-caller-identity
fi
