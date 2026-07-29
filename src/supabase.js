import { createClient } from '@supabase/supabase-js'

// Nanti kita akan ganti teks di bawah dengan kunci aslimu
const supabaseUrl = 'https://seenowyyryofoypjvaxo.supabase.co'
const supabaseKey = 'sb_publishable_9SmYhUcpuoq2iaPWg6V_qw_Go22UOkV'

export const supabase = createClient(supabaseUrl, supabaseKey)