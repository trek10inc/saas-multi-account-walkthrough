#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CentralSaasStack } from '../lib';

const app = new cdk.App();

new CentralSaasStack(app, 'CentralSaaSStack');

app.synth();
