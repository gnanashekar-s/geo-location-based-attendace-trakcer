1

Data Engineering Capability Training

Cohort-1: Databricks + Agentic Ai

Final Assignment

2

The Business Problem: What Are We Solving?

Imagine your stakeholder asks a seemingly simple question: "Did our Login API meet its required uptime this month, and what are the security rules for passwords?"

In the real world, answering this is surprisingly painful because company data is split into two completely different worlds:

1\.

The Text World: The security rules exist inside standard policy documents.

2\.

The Number World: The API uptime metrics are buried in a massive SQL database.

The Old Way: To go through the PDF and then write a SQL queries to check the database. It takes 2-3 days to get an answer.

The New Way (What you will be building!): Unlike a standard chatbot that just guesses answers, an "Agent" is an AI that has been given tools (like digital hands). When the stakeholder asks that question, your Agent is smart enough to say:

1\.

"I need to read the PDF for the password rules." (It uses your Vector Search tool).

2\.

"I need to check the database for the uptime." (It uses your SQL tool).

Companies are no longer just building chatbots; they are building "Agentic AI"—AI that can actually do work by talking to company databases and reading company files securely.

Overview

Build a comprehensive Agentic RAG application. The workflow entails ingesting software requirements, maintaining a synced Vector Search index, and equipping LLMs with advanced tool-calling capabilities (spanning SQL execution, Web search, and Managed MCP). You will mathematically grade the agent using MLflow 3 and schedule the complete pipeline using Lakeflow Jobs.

Note: You may encounter infrastructure restrictions depending on your Databricks Workspace tier (e.g., Free/Serverless compute limits). A core part of this assessment evaluates your ability to engineer resilient workarounds when premium endpoints or clusters are restricted, acting as a true Software Engineer.

3

MILESTONE-1: FOUNDATION, GOVERNANCE \& AI GATEWAY

Focus: Environment setup, Delta Lake (CDF), Unity Catalog, and centralized AI controls.

•

Milestone 1.1: Environment \& Unity Catalog Privileges

o

Task: Create a setup notebook that programmatically locks your runtime/version dependencies. Setup your Unity Catalog environment by creating a dedicated catalog and schema (nexus\_catalog.dev\_schema). Finally, write the necessary SQL GRANT statements to establish fine-grained privileges, simulating distinct access roles for human analysts versus automated agents.

•

Milestone 1.2: AI Gateway \& Credential Management

o

Task: Hardcoding API keys is a strict security violation. Utilize Databricks Secrets for centralized credential management of your external model endpoints. (do not store actual API keys). Bind these secrets securely to your environment. Additionally, write a brief Markdown specification detailing how an Enterprise AI Gateway handles rate limits (QPM/TPM) and guardrails.

•

Milestone 1.3: Unstructured Ingestion \& CDF

o

Task: Create a Unity Catalog Volume and upload software requirements. Build a pipeline to ingest these unstructured documents into a Bronze Delta table using native Databricks AI parsing functions. Then, extract and clean this data into a silver\_requirements table. You must enable Delta Change Data Feed (CDF) on this table. Document briefly about why CDF is a mandatory requirement for Databricks Vector Search.

•

Milestone 1.4: Auto Loader Ingestion \& "Semantic" Knowledge Store

o

Task: Generate mock API usage metrics (CSV/JSON) in a Volume. Implement Databricks Auto Loader to incrementally stream this data into a Bronze table. Transform it into a silver\_api\_kpis table by calculating a new metric (e.g., error rate percentage). Finally, use SQL to heavily curate the schema—add rich natural-language table/column descriptions and inject an ai\_query\_example table property to prime future Text-to-SQL agents.

4

MILESTONE-2: VECTOR SEARCH, RERANKING \& ENDPOINT LIFECYCLE

Focus: Native Embedding Models, Continuous Vector Indexes, Native Reranking, and Cost Management.

•

Milestone 2.1: Chunking \& Native Embeddings

o

Task: Read your silver\_requirements text and chunk it optimally for LLM ingestion. Design a scalable, distributed chunking method (e.g., using PySpark/Pandas UDFs). Assign a unique primary key to each chunk and save the output to a gold\_chunks Delta table with CDF enabled.

•

Milestone 2.2: Serving Endpoint Ops \& Lifecycle

o

Task: Do not use the Databricks UI for this task. Use the Databricks Python SDK to programmatically provision a Vector Search Endpoint. Because provisioning takes time, write an operational polling script that continuously monitors the endpoint and blocks downstream code execution until the status officially registers as READY.

•

Milestone 2.3: Continuous Vector Sync Strategy

o

Task: Using the SDK, configure a Continuous (or Triggered) Delta Sync Index on your gold\_chunks table. Connect it to a Databricks Foundation Model for automated embeddings. Write a monitoring loop to verify the synchronization is complete (matching source row counts) before proceeding.

•

Milestone 2.4: Native Reranking \& Retrieval

o

Task: Write a two-stage search\_knowledge\_base retrieval function.

▪

Stage 1: Execute a Vector Search query to retrieve the top 10 chunks.

▪

Stage 2: Pass those chunks to a Databricks Foundation Model Reranker endpoint to strictly re-order them based on semantic relevance, returning the exact top 3.

5

MILESTONE-3: AGENT FRAMEWORK, MCP, GENIE SPACES \& DATABRICKS APPS

Focus: Unity Catalog Tools, Databricks Agent Framework, and Hosted UI.

•

Milestone 3.1: Unity Catalog Functions as Tools (Managed MCP)

o

Task: Build an SLA Calculator tool for your Agent. Instead of a standard Python notebook function, register this natively as a Unity Catalog Python Function using Spark SQL so it executes securely on serverless compute. This acts as our Managed Model Context Protocol (MCP), centrally governing what the Agent can access. Include strict defensive logic (error handling for nulls/divide-by-zero) and leverage the SQL COMMENT property to define the tool's system prompt.

•

Milestone 3.2: Agent Assembly (SQL, RAG, Web)

o

Task: Assemble an intelligent reasoning Agent. Equip it with three distinct tools:

a.

Your Vector Search retriever (from 2.4).

b.

Your native UC SLA Calculator execution (from 3.1).

c.

A generic Web Search Tool (e.g., Wikipedia or DuckDuckGo) to handle out-of-domain knowledge. Use an Agent Framework to create a routing loop that can dynamically choose between answering from text (RAG), calculating math (SQL), or searching the internet (Web) based on the user's prompt.

•

Milestone 3.3: Databricks Genie Space Setup

o

Task: Create a "Data Q\&A Agent" capable of translating natural language into SQL queries against your silver\_api\_kpis table. It must automatically leverage the semantic metadata you created in Milestone 1.4 to understand the data context. (If native UI Genie Spaces are blocked by your workspace tier, engineer a code-based Text-to-SQL Agent equivalent using LangChain toolkits).

•

Milestone 3.4: Deploy a Databricks App

o

Task: Business users will not use a notebook to chat with your Agent. Write a Streamlit frontend UI for your Copilot where a human can review, validate, and interact with the Agent's reasoning. Databricks Apps feature (via SDK or REST API) to deploy it securely to a Databricks workspace URL.

6

MILESTONE-4: MLFLOW 3, NATIVE EVAL, AI FUNCTIONS \& LAKEFLOW JOBS

Focus: Real Inference Tables, LLM Judges, ai\_query, and GenAI DAGs.

•

Milestone 4.1: MLflow Tracing \& Native Inference Tables

o

Task: Enable Observability. Configure MLflow 3 to automatically trace your Agent’s reasoning (autolog). Execute test queries and verify that MLflow captures the exact token consumption, millisecond latencies, and generates visual Directed Acyclic Graphs (DAGs) of the Agent's tool-calling logic in your workspace Experiments tab.

•

Milestone 4.2: MLflow 3 GenAI Evaluation

o

Task: Implement an "LLM-as-a-Judge" to mathematically grade your Agent. Create a test dataset (Pandas DataFrame) of hypothetical questions and ground-truth answers. Use MLflow's GenAI evaluation metrics to grade your Agent's predictions on a strict 1-to-5 accuracy scale. Output the final scorecard containing the numerical scores and the Judge's written justifications.

•

Milestone 4.3: AI Functions (ai\_query) \& Corpora

o

Task: Demonstrate batch LLM processing using Spark SQL. Create a mock table of unstructured text requirements. Use the native Databricks ai\_query() SQL function to route this text into a hosted Foundation Model, prompting it to extract technical keywords across thousands of rows simultaneously.

•

Milestone 4.4: Lakeflow Jobs for GenAI Pipelines

o

Task: Orchestrate your pipeline. Use the Databricks SDK or REST API to schedule your full GenAI DAG as a Databricks Workflow (Lakeflow Job). Configure a maximum of 3 retries, set a job parameter (env=prod), and target your notebook for execution.

7

Submission Instructions

Please submit your work as a .zip file containing:

1\.

Notebook Files: .ipynb format.

2\.

Code Clarity: Add clear comments and markdowns in the notebook for the tasks

3\.

Additional Scripts/Configs: Python scripts or external files.

4\.

Documentation: Screenshots of key steps and results.

5\.

README File: Clear execution instructions.



