export type AIProvider = "GEMINI" | "GROQ" | "CEREBRAS" | "OPENROUTER" | "OPENAI";

type RunAIInput = {
  prompt: string;
  schema?: any;
};

type RunAIResult = {
  text: string;
  provider: AIProvider;
  model: string;
};

const providers: Array<{name:AIProvider; key:string; baseUrl:string; model:string}> = [
  { name:"GEMINI", key:"GEMINI_API_KEY", baseUrl:"", model:process.env.GEMINI_MODEL || "gemini-3.6-flash" },
  { name:"GROQ", key:"GROQ_API_KEY", baseUrl:"https://api.groq.com/openai/v1", model:process.env.GROQ_MODEL || "openai/gpt-oss-120b" },
  { name:"CEREBRAS", key:"CEREBRAS_API_KEY", baseUrl:"https://api.cerebras.ai/v1", model:process.env.CEREBRAS_MODEL || "gpt-oss-120b" },
  { name:"OPENROUTER", key:"OPENROUTER_API_KEY", baseUrl:"https://openrouter.ai/api/v1", model:process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free" },
  { name:"OPENAI", key:"OPENAI_API_KEY", baseUrl:"https://api.openai.com/v1", model:process.env.OPENAI_MODEL || "gpt-5.6-luna" }
];

function extractOpenAIText(data:any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((x:any)=>typeof x?.text==="string"?x.text:"").join("").trim();
  return "";
}

async function callGemini(p:any, apiKey:string, input:RunAIInput):Promise<string> {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(p.model)+":generateContent?key="+encodeURIComponent(apiKey),
    {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contents:[{parts:[{text:input.prompt}]}],
        generationConfig: input.schema
          ? {responseMimeType:"application/json",responseSchema:input.schema}
          : undefined
      }),
      cache:"no-store"
    }
  );
  if(!response.ok) return "";
  const data=await response.json().catch(()=>null);
  return String(data?.candidates?.[0]?.content?.parts?.map((x:any)=>x?.text||"").join("")||"").trim();
}

async function callOpenAICompatible(p:any, apiKey:string, input:RunAIInput):Promise<string> {
  const body:any={
    model:p.model,
    messages:[{role:"user",content:input.prompt}],
    temperature:0
  };
  if(input.schema) {
    body.response_format={
      type:"json_schema",
      json_schema:{name:"agent_json",strict:true,schema:input.schema}
    };
  }
  const response=await fetch(p.baseUrl+"/chat/completions",{
    method:"POST",
    headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
    body:JSON.stringify(body),
    cache:"no-store"
  });
  if(!response.ok) return "";
  return extractOpenAIText(await response.json().catch(()=>null));
}

export async function runBusinessAI(input:RunAIInput):Promise<RunAIResult|null> {
  for(const p of providers) {
    const apiKey=process.env[p.key];
    if(!apiKey) continue;
    try {
      let text = p.name==="GEMINI"
        ? await callGemini(p,apiKey,input)
        : await callOpenAICompatible(p,apiKey,input);
      // Some free OpenAI-compatible providers reject strict json_schema response_format.
      // Retry without provider-specific structured-output enforcement; the prompt still
      // requires JSON and the caller validates/parses the result.
      if(!text && input.schema){
        text = p.name==="GEMINI"
          ? await callGemini(p,apiKey,{...input,schema:undefined})
          : await callOpenAICompatible(p,apiKey,{...input,schema:undefined});
      }
      if(text) return {text,provider:p.name,model:p.model};
    } catch {
      // A provider failure is expected in a free-tier failover chain.
      // Continue to the next provider instead of stopping the agent.
    }
  }
  return null;
}
