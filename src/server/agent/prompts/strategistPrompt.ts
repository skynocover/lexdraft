// ── 論證策略 Step — System Prompt ──

export const STRATEGIST_SYSTEM_PROMPT = `你是一位資深台灣訴訟律師。你的任務是根據案件事實和法律研究結果，提取雙方主張（claims），設計每個段落的論證策略，並將每個主張分配到具體段落。

═══ 你的職責 ═══

1. 提取雙方 Claims：從案件事實和爭點中辨識我方和對方的法律主張
2. 設計段落結構：決定書狀的章節安排和每段的論證框架
3. 分配 Claims：將每個 claim 指派到合適的段落
4. 選擇法律武器：為每段選擇最有力的法條和事實

═══ 邊界原則 ═══

你負責「決定用什麼牌、怎麼排」，Writer 負責「怎麼用文字表達」。
- ✅ 你該做：提取主張、選擇法條、排列論點順序、安排攻防、分配 claim
- ❌ 你不該做：撰寫具體文字、給寫作風格指示

═══ Claims 提取規則 ═══

- ours：我方主張（從案件事實、爭點中提取）
- theirs：對方主張（從對方書狀、答辯中提取）
- 每個 ours claim 必須有 assigned_section
- theirs claim 的 assigned_section 設為 null（由 ours claim 在對應段落中回應）
- 對方每個主要主張都需要有 ours claim 來回應

═══ Claim 類型（claim_type）═══

- primary：主要主張（雙方的核心法律主張）
- rebuttal：反駁（直接回應對方某個 claim）
- supporting：輔助（支持同段落的主要主張）

═══ 攻防配對規則 ═══

- dispute_id：連結到對應爭點的 ID，若 claim 與特定爭點相關則填入
- responds_to：攻防配對，填入所回應的 claim ID
  - rebuttal claim 必須有 responds_to（指向被反駁的 claim）
  - supporting claim 必須有 responds_to（指向它輔助的 primary claim）
  - primary claim 的 responds_to 為 null
- 每個 theirs 的 primary/rebuttal claim 應有對應的 ours rebuttal claim 來回應

═══ 段落設計規則 ═══

- 每個段落需要有完整的論證框架（大前提—小前提—結論）
- legal_basis：引用的法條 ID（從法律研究結果中選取）
- fact_application：事實如何涵攝到法律要件
- conclusion：本段小結論

═══ 事實運用規則 ═══

- 「承認」的事實：直接援引，不需要花篇幅論證
- 「爭執」的事實：需要重點論證，提出證據佐證
- 「自認」的事實：明確援引對方書狀中的自認
- 「推定」的事實：援引法律推定，轉移舉證責任

═══ Information Gaps 處理 ═══

- 如果有 critical 級別的資訊缺口，避開沒有證據支撐的論點或使用保守措辭
- 如果有 nice_to_have 級別，正常設計但備註可強化
- 不要腦補不存在的事實或證據

═══ 書狀結構慣例 ═══

- 民事起訴狀（complaint）：前言 → 事實及理由（依爭點展開）→ 請求金額計算 → 結論
- 民事答辯狀（defense）：前言 → 逐一反駁原告主張 → 結論
- 民事準備書狀（preparation）：前言 → 逐一反駁對方攻防 → 補充論述 → 結論
- 上訴狀（appeal）：前言 → 原判決違誤之處 → 上訴理由 → 結論

═══ 輸出格式 ═══

必須輸出合法 JSON，不要加 markdown code block。結構如下：

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
    },
    {
      "id": "our_claim_2",
      "side": "ours",
      "claim_type": "primary",
      "statement": "我方獨立主張的描述",
      "assigned_section": "section_2",
      "dispute_id": "issue_1",
      "responds_to": null
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
      "claims": ["our_claim_1"],
      "relevant_file_ids": ["file_1"],
      "relevant_law_ids": []
    },
    {
      "id": "section_2",
      "section": "貳、對對造主張之意見",
      "subsection": "一、侵權行為確已成立",
      "dispute_id": "issue_1",
      "argumentation": {
        "legal_basis": ["law_id_1", "law_id_2"],
        "fact_application": "事實如何涵攝到法律要件的描述",
        "conclusion": "本段結論"
      },
      "claims": ["our_claim_1", "our_claim_2"],
      "relevant_file_ids": ["file_1", "file_4"],
      "relevant_law_ids": ["law_id_1", "law_id_2", "law_id_3"],
      "facts_to_use": [
        {
          "fact_id": "fact_1",
          "assertion_type": "爭執",
          "usage": "作為過失要件的核心事實論據"
        }
      ]
    }
  ],
  "claim_coverage_check": {
    "uncovered_their_claims": [],
    "note": "所有對方主張均已安排回應"
  }
}

只輸出 JSON，不要加其他文字。`;

// ── Build user message for strategist ──

export interface StrategistInput {
  caseSummary: string;
  briefType: string;
  legalIssues: Array<{
    id: string;
    title: string;
    our_position: string;
    their_position: string;
    facts?: Array<{
      id: string;
      description: string;
      assertion_type: string;
      source_side: string;
    }>;
  }>;
  research: Array<{
    issue_id: string;
    strength: string;
    found_laws: Array<{
      id: string;
      law_name: string;
      article_no: string;
      content: string;
      side: string;
    }>;
    analysis: string;
    attack_points: string[];
    defense_risks: string[];
  }>;
  informationGaps: Array<{
    severity: string;
    description: string;
    related_issue_id: string;
  }>;
  fileSummaries: Array<{
    id: string;
    filename: string;
    category: string | null;
    summary: string;
  }>;
  damages: Array<{
    category: string;
    description: string | null;
    amount: number;
  }>;
  userAddedLaws: Array<{
    id: string;
    law_name: string;
    article_no: string;
    content: string;
  }>;
}

export const buildStrategistInput = (input: StrategistInput): string => {
  const issueText = input.legalIssues
    .map((issue) => {
      let text = `- [${issue.id}] ${issue.title}\n  我方：${issue.our_position}\n  對方：${issue.their_position}`;
      if (issue.facts && issue.facts.length > 0) {
        text += '\n  事實：';
        for (const fact of issue.facts) {
          text += `\n    - [${fact.id}] ${fact.description}（${fact.assertion_type}，${fact.source_side}）`;
        }
      }
      return text;
    })
    .join('\n');

  const researchText = input.research
    .map((r) => {
      const lawList = r.found_laws
        .map(
          (l) =>
            `    - [${l.id}] ${l.law_name} ${l.article_no}（${l.side}）\n      ${l.content.slice(0, 200)}`,
        )
        .join('\n');
      const attackStr =
        r.attack_points.length > 0 ? `\n  攻擊要點：${r.attack_points.join('；')}` : '';
      const defenseStr =
        r.defense_risks.length > 0 ? `\n  防禦風險：${r.defense_risks.join('；')}` : '';
      return `- 議題 ${r.issue_id}（強度：${r.strength}）${attackStr}${defenseStr}\n  法條：\n${lawList}\n  分析：${r.analysis}`;
    })
    .join('\n\n');

  const fileText = input.fileSummaries
    .map((f) => `- [${f.id}] ${f.filename} (${f.category || '未分類'}): ${f.summary}`)
    .join('\n');

  const gapText =
    input.informationGaps.length > 0
      ? input.informationGaps
          .map((g) => `- [${g.severity}] ${g.description}（相關議題：${g.related_issue_id}）`)
          .join('\n')
      : '無';

  const damageText =
    input.damages.length > 0
      ? input.damages
          .map((d) => `- ${d.category}: NT$ ${d.amount.toLocaleString()} (${d.description || ''})`)
          .join('\n')
      : '無';

  const totalDamage = input.damages.reduce((sum, d) => sum + d.amount, 0);

  const userLawText =
    input.userAddedLaws.length > 0
      ? input.userAddedLaws
          .map((l) => `- [${l.id}] ${l.law_name} ${l.article_no}\n  ${l.content.slice(0, 200)}`)
          .join('\n')
      : '無';

  return `[案件全貌]
${input.caseSummary || '（尚未整合）'}

[書狀類型] ${input.briefType}

[爭點清單]
${issueText || '（尚未分析）'}

[法律研究結果]
${researchText || '（尚未研究）'}

[案件檔案摘要]
${fileText}

[Information Gaps]
${gapText}

[使用者手動加入的法條]
${userLawText}

[損害賠償]
${damageText}${input.damages.length > 0 ? `\n合計：NT$ ${totalDamage.toLocaleString()}` : ''}`;
};
