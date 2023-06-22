import { Context } from 'aws-lambda';
import moment from 'moment';


interface LambdaResponse {
    statusCode: number;
    body: string;
}

export async function handler(event: any, context: Context): Promise<LambdaResponse> {
    // Get the current moment
    const now = moment();

    // Get the deployment window time
    const [deploymentWindowHour, deploymentWindowMinute] = (process.env.DEPLOYMENT_WINDOW || '00:00').split(':').map(Number);

    // Calculate the moment of the next deployment window
    const nextDeploymentWindow = moment().hour(deploymentWindowHour).minute(deploymentWindowMinute);
    if (now.isAfter(nextDeploymentWindow)) {
        // If the deployment window has already passed today, add 1 day
        nextDeploymentWindow.add(1, 'day');
    }

    // Calculate the time until the next deployment window in seconds
    const timeUntilNextDeploymentWindowSeconds = nextDeploymentWindow.diff(now, 'seconds');

    // Return the time until the next deployment window
    return {
        statusCode: 200,
        body: JSON.stringify({ timeUntilNextDeploymentWindowSeconds }),
    };
}
