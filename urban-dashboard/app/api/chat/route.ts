import { GoogleGenerativeAI, SchemaType, FunctionDeclaration } from '@google/generative-ai';
import { NextResponse } from 'next/server';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

// --- tool declarations the model can call ----------------------------------
const tools: FunctionDeclaration[] = [
  {
    name: 'runScenario',
    description:
      'Run the predictive models for an intervention scenario on a neighbourhood and ' +
      'return the resulting cycling propensity, elderly car-risk and amenity gap. ' +
      'Use this whenever the user asks "what if" we add amenities or improve accessibility.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        buurtcode: { type: SchemaType.STRING, description: 'CBS buurtcode; omit to use the selected neighbourhood' },
        add_schools: { type: SchemaType.INTEGER, description: 'number of new schools (0-5)' },
        add_groceries: { type: SchemaType.INTEGER, description: 'number of new grocery stores (0-5)' },
        add_healthcare: { type: SchemaType.INTEGER, description: 'number of new healthcare facilities (0-5)' },
        accessibility_pct: { type: SchemaType.INTEGER, description: 'accessibility / bike-lane boost percentage (0-100)' },
        applyToUI: { type: SchemaType.BOOLEAN, description: 'also move the dashboard sliders to this scenario' },
      },
    },
  },
  {
    name: 'selectNeighborhood',
    description: 'Look up a neighbourhood or municipality by name and select it on the dashboard.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { name: { type: SchemaType.STRING, description: 'neighbourhood or municipality name' } },
      required: ['name'],
    },
  },
];

async function callBackend(path: string, init?: RequestInit) {
  const r = await fetch(`${BACKEND}${path}`, init);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export async function POST(req: Request) {
  try {
    const { message, dashboardState, history = [] } = await req.json();
    const selectedCode: string | undefined = dashboardState?.selected?.buurtcode;

    const formattedHistory = history.map((m: { role: string; text: string }) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: [{ functionDeclarations: tools }],
      systemInstruction: `You are an AI Urban Policy Assistant for Dutch municipalities, embedded in a
"10-minute bike-shed" equity dashboard. You are an explanation and policy-support layer on top of
trained predictive models (RQ1 cycling propensity, RQ2 elderly car-dependency) — you never invent
numbers; you obtain them through the runScenario tool, which calls the real models.

How to read the data:
- access_index = number of essential amenities reachable within a 3 km (10-minute) bike ride.
- usage_share = share of local trips actually cycled (ODiN); null means that municipality was not sampled.
- Quadrants: "success" (good access + high cycling), "opportunity" (good access but LOW cycling — the
  key policy target), "stretched" (low access yet people cycle), "underserved" (low access + low cycling).
- car_risk = RQ2 elderly car-dependency index; it is class-balanced, so treat it as RELATIVE, not an absolute probability.

Rules:
1. Be concise, objective and policy-oriented. Use bullet points and concrete numbers.
2. For any "what-if", CALL runScenario and base your answer on the returned baseline→scenario deltas.
3. Be honest that Dutch cycling is only weakly access-elastic (unlike the 84% access–usage link found
   for US walking). Don't overstate the effect of adding amenities; emphasise targeting "opportunity"
   neighbourhoods and the trade-offs.
4. End substantive answers with one short, data-grounded recommendation.`,
    });

    const chat = model.startChat({ history: formattedHistory });

    const prompt = `CURRENT DASHBOARD CONTEXT:
${JSON.stringify(dashboardState ?? {}, null, 2)}

USER: "${message}"`;

    let result = await chat.sendMessage(prompt);
    const uiAction: { type: string; payload: Record<string, unknown> } | null = { type: '', payload: {} };
    let actionToReturn: typeof uiAction = null;

    // function-calling loop (bounded)
    for (let i = 0; i < 4; i++) {
      const calls = result.response.functionCalls();
      if (!calls || calls.length === 0) break;

      const responses = [];
      for (const call of calls) {
        const args = (call.args ?? {}) as Record<string, unknown>;
        let data: unknown = { error: 'unknown tool' };

        if (call.name === 'runScenario') {
          const code = (args.buurtcode as string) || selectedCode;
          if (!code) {
            data = { error: 'No neighbourhood selected. Ask the user to pick one first.' };
          } else {
            const scenario = {
              add_schools: Number(args.add_schools ?? 0),
              add_groceries: Number(args.add_groceries ?? 0),
              add_healthcare: Number(args.add_healthcare ?? 0),
              accessibility_pct: Number(args.accessibility_pct ?? 0),
              model: dashboardState?.scenario?.model || 'logistic_regression',
            };
            try {
              data = await callBackend('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ buurtcode: code, scenario }),
              });
              if (args.applyToUI) actionToReturn = { type: 'updateScenario', payload: scenario };
            } catch {
              data = { error: 'model backend unreachable' };
            }
          }
        } else if (call.name === 'selectNeighborhood') {
          try {
            const hits = await callBackend(`/api/search?q=${encodeURIComponent(String(args.name))}`);
            if (Array.isArray(hits) && hits.length) {
              data = hits[0];
              actionToReturn = { type: 'selectNeighborhood', payload: { buurtcode: hits[0].buurtcode } };
            } else {
              data = { error: 'no match found' };
            }
          } catch {
            data = { error: 'search failed' };
          }
        }

        responses.push({
          functionResponse: { name: call.name, response: { result: data } },
        });
      }

      result = await chat.sendMessage(responses);
    }

    return NextResponse.json({
      text: result.response.text() || 'I could not produce a response.',
      action: actionToReturn,
    });
  } catch (error) {
    console.error('Gemini API Error:', error);
    return NextResponse.json({ error: 'Failed to generate response' }, { status: 500 });
  }
}
