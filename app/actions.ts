"use server";

import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { groupedRecordsSchema } from "./schema";

// Configured for local Ollama as requested previously
const localOllama = createOpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

// STAGE 1: LOCAL BLOCKING
export function getCandidateClusters(data: any[]) {
  const exactSsnMap = new Map();
  const fuzzyMap = new Map();

  data.forEach((rec) => {
    if (!exactSsnMap.has(rec.ssn)) exactSsnMap.set(rec.ssn, []);
    exactSsnMap.get(rec.ssn).push(rec);

    const fuzzyKey = `${rec.last_name.toLowerCase()}-${rec.date_of_birth}`;
    if (!fuzzyMap.has(fuzzyKey)) fuzzyMap.set(fuzzyKey, []);
    fuzzyMap.get(fuzzyKey).push(rec);
  });

  const clusters = [];
  for (const group of exactSsnMap.values()) {
    if (group.length > 1) clusters.push({ type: "EXACT_SSN", records: group });
  }

  for (const group of fuzzyMap.values()) {
    if (group.length > 1) {
      const allSameSsn = group.every((r) => r.ssn === group[0].ssn);
      if (!allSameSsn) {
        clusters.push({ type: "FUZZY_SSN_TYPO", records: group });
      }
    }
  }
  return clusters;
}

// STAGE 2: AI BATCH PROCESSING
export async function runOperationCleanSlate(rawData: any[]) {
  const clusters = getCandidateClusters(rawData);
  const results = [];

  // Process in small batches
  for (let i = 0; i < clusters.length; i += 3) {
    const batch = clusters.slice(i, i + 3);

    const response = await generateText({
      model: localOllama("llama3.1"), // Use your local model here
      system: `You are the lead architect for Operation Clean Slate.
      Group duplicate financial records.
      - EXACT_SSN: Confidence 1.0.
      - FUZZY_SSN_TYPO: If SSNs differ by 1-2 digits but Name/DOB match, group them with 0.85 confidence.
      - Identify field conflicts in the summary (e.g., "Suspected SSN transposition").`,
      prompt: `Analyze these candidate groups: ${JSON.stringify(batch)}`,
      output: Output.object({
        schema: groupedRecordsSchema,
        name: "grouped_clients",
        description:
          "Groups of duplicate client records with conflict summaries.",
      }),
    });

    // Extract the typed object from the text generation response
    const parsedResult =
      response.experimental_output || JSON.parse(response.text);
    results.push(...parsedResult.groups);
  }

  return results;
}
