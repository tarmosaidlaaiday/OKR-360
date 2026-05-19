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

    const { objective_title, unit_name, industry } = await req.json()
    if (!objective_title?.trim()) {
      return new Response(JSON.stringify({ error: 'objective_title is required' }), { status: 400, headers: corsHeaders })
    }

    const client = new Anthropic()

    const prompt = `You are an OKR expert. A user is creating an OKR objective for their organisation.

Objective: "${objective_title.trim()}"
${unit_name ? `Team/unit: ${unit_name}` : ''}
${industry ? `Industry: ${industry}` : ''}

Suggest exactly 3 strong Key Results for this objective.
Rules:
- Each KR must be measurable and specific (not vague)
- Include a target number/percentage
- Focus on outcomes not activities
- Use the format: verb + metric + target + timeframe

Respond ONLY with valid JSON, no explanation:
{
  "suggestions": [
    {
      "title": "Reach X paying customers",
      "target_type": "numeric",
      "unit": "customers",
      "target_value": 100
    }
  ]
}`

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    let parsed: { suggestions: unknown[] }
    try {
      parsed = JSON.parse(text)
    } catch {
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('AI returned unparseable response')
      parsed = JSON.parse(match[0])
    }

    if (!Array.isArray(parsed?.suggestions)) throw new Error('Unexpected AI response shape')

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('suggest-key-results error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
