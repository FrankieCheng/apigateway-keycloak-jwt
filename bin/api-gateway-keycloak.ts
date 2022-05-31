#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ApiGatewayKeycloakStack } from '../lib/apigateway-keycloak-stack';

const app = new cdk.App();

new ApiGatewayKeycloakStack(app, 'ApiGatewayKeycloakStack');