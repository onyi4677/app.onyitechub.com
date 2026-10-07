import os
import boto3

DYNAMODB_TABLE_NAME = os.getenv("DYNAMODB_TABLE_NAME", "onyitech-research-projects")
dynamodb = boto3.resource("dynamodb")
projects_table = dynamodb.Table(DYNAMODB_TABLE_NAME)
