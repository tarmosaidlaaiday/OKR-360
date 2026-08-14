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

Respond ONLY with valid JSON, no explanation:
{
  "suggestions": [
    {
      "title": "string — concise, action-oriented KR title",
      "target_type": "numeric" | "percentage" | "boolean",
      "unit": string | null,
      "target_value": number
    }
  ]
}

Rules for target_type — it MUST be exactly one of these three values, nothing else:
- "percentage": target_value is 0–100 (e.g. 85 means 85%). unit must be null.
- "numeric": target_value is the absolute goal number. unit describes what is counted (e.g. "users", "$", "USD", "tickets"). Use this for ALL monetary/revenue/currency targets — never invent a type like "currency" or "dollar".
- "boolean": use only for binary done/not-done outcomes. target_value is always 1. unit is null.

Additional rules:
- Each KR must be measurable and specific (not vague)
- Focus on outcomes not activities
- Use the format: verb + metric + target + timeframe`

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

    // Runtime validation: coerce any invalid target_type to 'numeric' rather than
    // letting an invented value (e.g. 'currency') reach the database and fail there.
    const VALID_TARGET_TYPES = ['numeric', 'percentage', 'boolean']
    const validated = parsed.suggestions.map((s: unknown) => {
      const suggestion = s as Record<string, unknown>
      if (!VALID_TARGET_TYPES.includes(suggestion.target_type as string)) {
        console.warn(`suggest-key-results: coercing invalid target_type "${suggestion.target_type}" → "numeric"`)
        return { ...suggestion, target_type: 'numeric' }
      }
      return suggestion
    })

    return new Response(JSON.stringify({ suggestions: validated }), {
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
