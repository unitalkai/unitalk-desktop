export interface SpendLogMetadata {
  user_api_key_alias?: string | null
  user_api_key_user_id?: string | null
  user_api_key_team_alias?: string | null
  [key: string]: unknown
}

export interface SpendLogEntry {
  request_id: string
  api_key: string
  model: string
  user?: string
  user_id?: string
  user_email?: string
  team_id?: string
  org_id?: string
  spend: number
  total_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  startTime?: string
  endTime?: string
  created_at?: string
  metadata?: SpendLogMetadata | null
  end_user?: string
  api_base?: string
  provider?: string
  custom_llm_provider?: string
  app_id?: string
  status?: string
  request_status?: string
  monthly_cost?: number
  monthly_tokens?: number
}

export interface SpendLogsResponse {
  data: SpendLogEntry[]
  total: number
  total_count: number
  page: number
  page_size?: number
  total_pages?: number
}

export interface SpendFilters {
  startDate: string
  endDate: string
  model: string
  user: string
}

export interface UniqueLogUser {
  id: string
  label: string
}
