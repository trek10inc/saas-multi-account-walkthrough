export interface AccountData {
    accountId: string;
    customerName: string;
    expiration: string;
    products: [{
        name: string;
        version: string;
    }]
    adminEmails: string[];
    awsAccountId?: string;
    awsServiceCatalog?: {
        id: string;
        stepFunctionToken: string;
    };
    accountStatus: string;
    lastUpdated: string;
    pipelineName: string;
}

export interface AsyncAccountData {
    token: string;
    account: AccountData; 
}

export interface StepFunctionEvent<T> {
    value: T;
}