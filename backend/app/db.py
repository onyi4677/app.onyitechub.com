import os
import boto3

DYNAMODB_TABLE_NAME = os.getenv("DYNAMODB_TABLE_NAME", "onyitech-research-projects")
dynamodb = boto3.resource("dynamodb")
projects_table = dynamodb.Table(DYNAMODB_TABLE_NAME)

STUDY_SCREENING_TABLE_NAME = os.getenv("STUDY_SCREENING_TABLE_NAME", "").strip()
study_screening_table = dynamodb.Table(STUDY_SCREENING_TABLE_NAME) if STUDY_SCREENING_TABLE_NAME else None
