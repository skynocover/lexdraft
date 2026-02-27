// ── Shared constants for reasoning strategy prompts ──
// Used by both reasoningStrategyPrompt.ts (Reasoning 階段) and
// reasoningStrategyStep.ts (Structuring 階段) to avoid duplication.

export const BRIEF_STRUCTURE_CONVENTIONS = `═══ 書狀結構慣例（依民事訴訟法及實務慣例）═══

每份書狀必須包含「前言」和「結論」段落。段落編號使用中文數字：壹、貳、參…，子段落使用一、二、三…。

### 民事起訴狀（complaint）
壹、前言（案件背景、當事人關係）
貳、事實及理由
  依爭點逐一展開，每個爭點一個子段落（一、二、三…）
  每段應包含：請求權基礎 → 構成要件涵攝 → 小結論
參、損害賠償計算（如涉及金額請求）
  逐項列明各項損害金額及計算依據
肆、結論（綜上所述，請求鈞院判決如訴之聲明）

### 民事答辯狀（defense）
壹、前言（答辯立場概述）
貳、答辯理由
  逐一針對原告主張反駁，每點一個子段落
  對事實面：說明真實情形、反駁原告事實錯誤
  對法律面：提出時效抗辯、過失相抵等法律主張
參、結論（請求駁回原告之訴，訴訟費用由原告負擔）

### 民事準備書狀（preparation）
壹、前言（說明本狀目的、補充或回應之事項）
貳、對對造主張之意見
  逐一針對對方書狀攻防回應，每點一個子段落
參、補充論述（如有新事實、新證據或新法律主張）
肆、結論

### 上訴狀（appeal）
壹、前言（表明不服之判決）
貳、原判決違誤之處
  逐一指出原判決認事用法之錯誤
  每點應說明：原判決如何認定 → 為何有誤 → 正確應如何
參、上訴理由（補充事實及證據）
肆、結論（請求廢棄原判決，改判如上訴聲明）`;

export const CLAIMS_RULES = `═══ Claims 規則 ═══

### Claims 提取
- ours：我方主張（從案件事實、爭點中提取），必須有 assigned_section
- theirs：對方主張（從對方書狀、答辯中提取），assigned_section 為 null
- 對方每個主要主張都需要有 ours claim 來回應

### Claim 類型（claim_type）
- primary：主要主張（雙方的核心法律主張）
- rebuttal：反駁（直接回應對方某個 claim）
- supporting：輔助（支持同段落的主要主張）

### 攻防配對
- dispute_id：連結到對應爭點的 ID
- responds_to：攻防配對，填入所回應的 claim ID
  - rebuttal claim 必須有 responds_to（指向被反駁的 claim）
  - supporting claim 必須有 responds_to（指向它輔助的 primary claim）
  - primary claim 的 responds_to 為 null
- 每個 theirs 的 primary/rebuttal claim 應有對應的 ours rebuttal claim 來回應`;

export const SECTION_RULES = `═══ 段落規則 ═══

- 每個段落需要有完整的論證框架（大前提—小前提—結論）
- legal_basis：引用的法條 ID（必須是已查到全文的法條，且必須在 relevant_law_ids 中）
- fact_application：事實如何涵攝到法律要件
- conclusion：本段小結論
- dispute_id：連結到對應爭點的 ID（前言和結論不需要）
- relevant_file_ids：列出本段撰寫時需要引用的來源檔案 ID（重要！確保每個論述段都有對應的來源檔案，否則 Writer 無法產生引用標記）
- relevant_law_ids：列出本段需要引用的法條 ID
- legal_reasoning：本段的法律推理摘要（不超過 500 字），包含：
  - 為什麼用這個請求權基礎（如有比較則簡述理由）
  - 構成要件如何對應到事實
  - 預判對方可能的攻擊角度及我方回應`;

export const STRATEGY_JSON_SCHEMA = `═══ JSON 格式 ═══

{
  "claims": [
    {
      "id": "their_claim_1",
      "side": "theirs",
      "claim_type": "primary",
      "statement": "對方主張的描述",
      "assigned_section": null,
      "dispute_id": "issue_1",
      "responds_to": null
    },
    {
      "id": "our_claim_1",
      "side": "ours",
      "claim_type": "rebuttal",
      "statement": "反駁對方主張的一句話描述",
      "assigned_section": "section_2",
      "dispute_id": "issue_1",
      "responds_to": "their_claim_1"
    }
  ],
  "sections": [
    {
      "id": "section_1",
      "section": "壹、前言",
      "argumentation": {
        "legal_basis": [],
        "fact_application": "簡述案件背景",
        "conclusion": "本狀針對被告答辯逐一反駁"
      },
      "claims": ["our_claim_overview"],
      "relevant_file_ids": [],
      "relevant_law_ids": [],
      "legal_reasoning": ""
    },
    {
      "id": "section_2",
      "section": "貳、事實及理由",
      "subsection": "一、侵權行為確已成立",
      "dispute_id": "issue_1",
      "argumentation": {
        "legal_basis": ["B0000001-184"],
        "fact_application": "事實涵攝描述",
        "conclusion": "本段結論"
      },
      "claims": ["our_claim_1", "our_claim_2"],
      "relevant_file_ids": ["file_1"],
      "relevant_law_ids": ["B0000001-184"],
      "facts_to_use": [
        {
          "fact_id": "fact_1",
          "assertion_type": "爭執",
          "usage": "作為過失要件的核心事實論據"
        }
      ],
      "legal_reasoning": "以 184-1前段為主要請求權基礎..."
    },
    {
      "id": "section_last",
      "section": "參、結論",
      "argumentation": {
        "legal_basis": [],
        "fact_application": "",
        "conclusion": "綜上所述，請求鈞院判決如訴之聲明"
      },
      "claims": [],
      "relevant_file_ids": [],
      "relevant_law_ids": [],
      "legal_reasoning": ""
    }
  ]
}`;
