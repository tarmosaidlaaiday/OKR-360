import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const { description } = await req.json()
    if (!description?.trim()) {
      return new Response(JSON.stringify({ error: 'description is required' }), { status: 400, headers: corsHeaders })
    }

    const client = new Anthropic()

    const prompt = `You are an org chart expert. A user has described their company and you must convert it into a structured JSON org tree.

Company description: "${description.trim()}"

Rules:
- Return a JSON array of top-level units, each with a "name" (string) and "children" (array, same shape, can be empty [])
- Maximum depth: 4 levels (root counts as depth 0)
- Maximum total units: 30
- Use only the units clearly implied by the description — do not invent extras
- Keep names short (1–4 words)
- Every node must have both "name" and "children" fields

Respond ONLY with valid JSON, no explanation, no markdown:
[
  {
    "name": "Company",
    "children": [
      { "name": "Department A", "children": [] },
      { "name": "Department B", "children": [
        { "name": "Team B1", "children": [] }
      ]}
    ]
  }
]`

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Try to extract just the JSON array from surrounding text
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) throw new Error('AI returned unparseable response')
      parsed = JSON.parse(match[0])
    }

    if (!Array.isArray(parsed)) throw new Error('Unexpected AI response shape: expected a JSON array')

    return new Response(JSON.stringify({ units: parsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('suggest-org-structure error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
