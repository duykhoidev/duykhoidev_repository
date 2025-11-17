# Bot Mini-Clone Daily Job (Node.js/TypeScript)

This repository contains the solution for the Backend Take-Home Test, implementing a self-updating customer support bot based on the **OpenAI Assistants API** and scheduled for daily execution via **Railway**.

The solution uses **Node.js** and **TypeScript** for robust development.

---

## Project Setup

### 1. Prerequisites

- **Node.js** (v20+)
- **pnpm**
- **Docker**
- Active OpenAI API Key (`sk-proj-Nm-lr....`)
- Pre-configured OpenAI Assistant ID (`asst_ZdXUeUDFtj....`)

### 2. Installation

1.  Clone this repository.
2.  Install dependencies:

    ```bash
    pnpm install
    ```

3.  Create an environment file and fill in your secrets (keys, IDs, URLs):

    ```bash
    cp .env.sample .env
    ```

### 3. Chunking Strategy

We rely on **OpenAI's automatic semantic chunking and indexing**. The solution ensures high input quality by first using **`cheerio`** and **`turndown`** to clean the messy Zendesk HTML into standardized Markdown. We then rely on the Vector Store's internal embedding model to process these clean files, ensuring accurate retrieval and adherence to the system prompt constraints.

---

## Execution & Deliverables

### 1. How to Run Locally

To test the full daily job logic (Scrape, Delta Check, and Upload) locally and verify the Docker configuration:

1.  **Build the image:**

    ```bash
    docker build -t bot-clone-job .
    ```

2.  **Run and inject environment variables** (This simulates the production runtime and executes the entire job once):

    ```bash
    docker run \
      -e OPENAI_API_KEY="sk-proj-Nm-lr...." \
      -e ASSISTANT_ID="asst_ZdXUeUDFtj...." \
      -e ZENDESK_BASE_URL="https://support.optisigns.com" \
      -e DATA_DIR="src/data" \
      bot-clone-job
    ```

    _(The output will show the Delta Logic counts and the Vector Store upload process.)_

### 2. Daily Job Logs (Artifact)

The job is scheduled to run daily via a Cron Job on **The Railway Platform**. This link provides access to the service's last run status, confirming the delta logic and logging are functioning:

[Railway Job Logs Link - Final Artifact](https://railway.com/project/162380a9-f87b-40c9-b37e-43988f9b37f1?environmentId=f60bd297-f50e-4f7a-a725-da88161dfadb)

### 3. Screenshot of Playground Answer

The image below shows the successful Quick Sanity Check, validating that the Assistant adheres to all system prompt constraints (Tone, Max 5 bullets, and citing up to 3 `Article URL:` lines).

**Query:** “How do I add a YouTube video?”

> **Verification Note:**
> To verify the Assistant's functionality and strict adherence to the **System Prompt** using your own credentials:
>
> 1.  **Prerequisite:** Ensure the project has run successfully once (locally or on **Railway**) so the Vector Store is populated and attached to your `ASSISTANT_ID`.
> 2.  **Open Playground:** Go to the [OpenAI Playground](https://platform.openai.com/playground).
> 3.  **Select Assistant:** Switch to **Assistant** mode and select the Assistant matching your configured `ASSISTANT_ID`.
> 4.  **Run Test:** Input the test query: 
**"How do I add a YouTube video?"**
> 5.  **Verify Compliance:** Check that the response satisfies the verbatim prompt constraints:
>     - **Tone:** Helpful, factual, and concise.
>     - **Source:** Answers _only_ using the uploaded documents.
>     - **Format:** Uses **Max 5 bullet points**.
>     - **Citations:** Includes up to 3 **"Article URL:"** lines.
