import * as cdk from "aws-cdk-lib";
import {CfnParameter, RemovalPolicy, App} from "aws-cdk-lib";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from "@aws-cdk/aws-apigatewayv2-alpha";
import { HttpJwtAuthorizer } from '@aws-cdk/aws-apigatewayv2-authorizers-alpha';
import { LambdaToDynamoDB } from "@aws-solutions-constructs/aws-lambda-dynamodb";
import { HttpLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';

export class ApiGatewayKeycloakStack extends cdk.Stack {
  constructor(scope: App, id: string) {
    super(scope, id);

    const ddbBookTable = new ddb.Table(this, "books", {
      partitionKey: {
          name: "author",
          type: ddb.AttributeType.STRING,
      },
      sortKey: {
          name: "title",
          type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
  });

    const httpJwtAuthorizer = new HttpJwtAuthorizer('BooksAuthorizer', new CfnParameter(this, "jwtIssuer", {
        type: "String",
        description: "The JWT Issuer URL",
      }).valueAsString, {
        jwtAudience: new CfnParameter(this, "jwtAudience", {
          type: "CommaDelimitedList",
          description: "The the JWT token audience",
        }).valueAsList,
    });

    const updateBooks = new LambdaToDynamoDB(this, "updateBooks", {
      lambdaFunctionProps: {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "index.handler",
        code: lambda.Code.fromInline(`const aws = require('aws-sdk');
        const ddb = new aws.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });
        
        exports.handler = async(event) => {
            //print the jwt informaton to debug the values..
            console.log(event.requestContext.authorizer.jwt);
            try {
                const requestBody = JSON.parse(event.body);
                const params = {
                    TableName: process.env.DDB_TABLE_NAME,
                    Item: {
                        author: 'user#' + event.requestContext.authorizer.jwt.claims.preferred_username,
                        title: 'title#' + requestBody.title,
                        category: requestBody.category,
                        desc: requestBody.desc,
                        timeCreated: new Date().toISOString()
                    }
                };
                await ddb.put(params).promise();
                return {
                    data: "update successfully"
                }
            }
            catch (error) {
                console.error(error);
            }
        };`),
        timeout: cdk.Duration.seconds(30),
      },
      existingTableObj: ddbBookTable,
    });

    const queryBooks = new LambdaToDynamoDB(this, "queryBooks", {
      lambdaFunctionProps: {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "index.handler",
        code: lambda.Code.fromInline(`const AWS = require('aws-sdk');

        exports.handler = async(event) => {
            try {
                const dynamoDB = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });
                var allData = [];
                var data;
        
                // continue scanning if we have more books,
                // since scan can retrieve a maximum of 1MB of data
                var params = {
                    TableName: process.env.DDB_TABLE_NAME
                };
                do {
                    data = await dynamoDB.scan(params).promise();
                    allData.push(...data.Items);
                    params.ExclusiveStartKey = data.LastEvaluatedKey;
                } while (typeof data.LastEvaluatedKey != "undefined");
                return {
                    itemSize: allData.length,
                    data: allData
                }
            }
            catch (error) {
                console.error(error);
            }
        };`),
        timeout: cdk.Duration.seconds(30),
      },
      existingTableObj: ddbBookTable,
    });

    const httpApi = new apigatewayv2.HttpApi(this, "books-service-test");

    const httpStage = httpApi.addStage("release", {
      stageName: "release",
      autoDeploy: true,
    });

    const path = "/books";

    //add  query route.
    const queryRoute = httpApi.addRoutes({
      path: path,
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('queryBooks', queryBooks.lambdaFunction),
    });

    //add update route
    const updateRoute = httpApi.addRoutes({
      path: path,
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('updateBooks', updateBooks.lambdaFunction),
      authorizer: httpJwtAuthorizer,
    });

    new cdk.CfnOutput(this, 'api gateway url', {value: httpStage.url + path});

  }
}