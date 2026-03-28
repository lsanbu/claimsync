export interface FileRecord {
  file_id:         string
  file_name:       string
  file_type:       string | null
  file_size_bytes: number | null
  blob_path:       string | null
  uploaded_at:     string | null
  created_at:      string
}

export interface IntervalRecord {
  interval_index:   number
  type:             string
  from_time:        string | null
  to_time:          string | null
  files_found:      number | null
  request_blob:     string | null
  response_blob:    string | null
  request_exists:   boolean
  response_exists:  boolean
}
