import { z } from 'zod';

const clientRecordSchema = z.object({
  record_id: z.string(),
  ssn: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  date_of_birth: z.string(),
  address: z.string(),
});

export const groupedRecordsSchema = z.object({
  groups: z.array(z.object({
    group_id: z.string(),
    primary_ssn: z.string(),
    confidence_score: z.number(), // High if SSNs match exactly, lower if fuzzy
    records: z.array(clientRecordSchema),
    conflict_summary: z.string().describe('Short summary of what differs between these records'),
  }))
});