import { MongoClient } from 'mongodb';
import { resolveAlias, normalizeArticleNo, buildArticleId } from './lawConstants';

export interface LawArticle {
  _id: string;
  pcode: string;
  law_name: string;
  nature: string;
  category: string;
  chapter: string;
  article_no: string;
  content: string;
  aliases?: string;
  last_update: string;
  url: string;
  score: number;
}

/** Matches "民法第213條", "民法 第213條之1", "消保法第7條" etc. */
const ARTICLE_REGEX = /^(.+?)\s*(第\s*\S+?\s*條.*)$/;

/** Matches "民法 損害賠償", "勞動基準法 工時" — law name + concept */
const LAW_CONCEPT_REGEX = /^([\u4e00-\u9fff]+(?:法|規則|條例|辦法|細則))\s+(.+)$/;

const buildUrl = (pcode: string): string =>
  `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${pcode}`;

const MONGO_OPTS = {
  maxPoolSize: 1,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 10000,
};

export const searchLaw = async (
  mongoUrl: string,
  opts: { query: string; limit?: number; nature?: string },
): Promise<LawArticle[]> => {
  const { query, limit: rawLimit, nature } = opts;
  const limit = Math.min(Math.max(rawLimit || 10, 1), 50);

  if (!mongoUrl) {
    console.warn('searchLaw: MONGO_URL not set');
    return [];
  }

  const client = new MongoClient(mongoUrl, MONGO_OPTS);

  try {
    const coll = client.db('lawdb').collection('articles');
    const articleMatch = query.match(ARTICLE_REGEX);
    const lawConceptMatch = !articleMatch ? query.match(LAW_CONCEPT_REGEX) : null;

    // ── Strategy 0: Direct _id Lookup (O(1)) ──
    // If we can resolve the law name + article number to a known _id, use findOne
    if (articleMatch) {
      const rawLawName = articleMatch[1].trim();
      const rawArticle = articleMatch[2].trim();
      const resolvedName = resolveAlias(rawLawName);
      const normalizedArticle = normalizeArticleNo(rawArticle);
      const articleId = buildArticleId(resolvedName, normalizedArticle);

      if (articleId) {
        const doc = await coll.findOne({ _id: articleId } as Record<string, unknown>);
        if (doc) {
          return [
            {
              ...doc,
              url: buildUrl(doc.pcode as string),
              score: 1,
            } as unknown as LawArticle,
          ];
        }
      }
    }

    // ── Strategy 1: Exact article with regex (e.g. "民法第213條") ──
    // Use direct MongoDB find because Atlas Search text on keyword-mapped
    // article_no can't handle spacing differences ("第213條" vs "第 213 條")
    if (articleMatch) {
      const rawLawName = articleMatch[1].trim();
      const articleQuery = articleMatch[2].trim();
      const resolvedName = resolveAlias(rawLawName);
      const numMatch = articleQuery.match(/第\s*(\d+)\s*(條.*)/);
      if (numMatch) {
        const articleNum = numMatch[1];
        const suffix = numMatch[2].replace(/條|\s+/g, '');
        const articleRegex = suffix
          ? new RegExp(`第\\s*${articleNum}[-\\s]*${suffix.replace(/之/g, '[-之]\\s*')}\\s*條`)
          : new RegExp(`第\\s*${articleNum}\\s*條(?!\\s*之)(?!.*-)`);
        const directResults = await coll
          .find({
            $or: [{ law_name: resolvedName }, { aliases: { $regex: resolvedName } }],
            article_no: { $regex: articleRegex },
          })
          .limit(limit)
          .toArray();

        if (directResults.length > 0) {
          return directResults.map((r) => ({
            ...r,
            url: buildUrl(r.pcode as string),
            score: 1,
          })) as unknown as LawArticle[];
        }
      }
      // Fallback to Atlas Search below
    }

    // ── Build Atlas Search compound query ──
    let compound: Record<string, unknown>;

    if (articleMatch) {
      // Fallback for exact article when direct find returned nothing
      const rawLawName = articleMatch[1].trim();
      const articleQuery = articleMatch[2].trim();
      const resolvedName = resolveAlias(rawLawName);
      compound = {
        must: [
          {
            text: {
              query: resolvedName,
              path: ['law_name', 'aliases'],
              synonyms: 'law_synonyms',
            },
          },
        ],
        should: [{ text: { query: articleQuery, path: 'article_no' } }],
      };
    } else if (lawConceptMatch) {
      // ── Strategy 2: Law name + concept (e.g. "民法 損害賠償") ──
      // Filter to the specific law, then search concept in chapter/content
      const rawLawName = lawConceptMatch[1];
      const resolvedName = resolveAlias(rawLawName);
      const concept = lawConceptMatch[2];
      compound = {
        must: [
          {
            text: {
              query: resolvedName,
              path: ['law_name', 'aliases'],
              synonyms: 'law_synonyms',
            },
          },
        ],
        should: [
          {
            text: {
              query: concept,
              path: 'chapter',
              synonyms: 'law_synonyms',
              score: { boost: { value: 5 } },
            },
          },
          {
            text: {
              query: concept,
              path: 'content',
              synonyms: 'law_synonyms',
              score: { boost: { value: 3 } },
            },
          },
          {
            text: {
              query: concept,
              path: 'category',
              synonyms: 'law_synonyms',
            },
          },
        ],
        minimumShouldMatch: 1,
      };
    } else {
      // ── Strategy 3: General concept (e.g. "侵權行為", "損害賠償") ──
      compound = {
        should: [
          {
            text: {
              query,
              path: ['law_name', 'aliases'],
              synonyms: 'law_synonyms',
              score: { boost: { value: 5 } },
            },
          },
          {
            text: {
              query,
              path: 'chapter',
              synonyms: 'law_synonyms',
              score: { boost: { value: 3 } },
            },
          },
          {
            text: {
              query,
              path: 'content',
              synonyms: 'law_synonyms',
            },
          },
          {
            text: {
              query,
              path: 'category',
              synonyms: 'law_synonyms',
              score: { boost: { value: 0.5 } },
            },
          },
        ],
        minimumShouldMatch: 1,
      };
    }

    if (nature) {
      (compound as Record<string, unknown>).filter = [{ text: { query: nature, path: 'nature' } }];
    }

    const results = await coll
      .aggregate([
        { $search: { index: 'law_search', compound } },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            pcode: 1,
            law_name: 1,
            nature: 1,
            category: 1,
            chapter: 1,
            article_no: 1,
            content: 1,
            aliases: 1,
            last_update: 1,
            url: {
              $concat: ['https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=', '$pcode'],
            },
            score: { $meta: 'searchScore' },
          },
        },
      ])
      .toArray();

    return results as unknown as LawArticle[];
  } finally {
    await client.close().catch(() => {});
  }
};

/**
 * Batch law search — executes multiple queries with a single MongoClient connection.
 * Returns results keyed by original query string.
 */
export const searchLawBatch = async (
  mongoUrl: string,
  queries: { query: string; limit?: number }[],
): Promise<Map<string, LawArticle[]>> => {
  const resultMap = new Map<string, LawArticle[]>();

  if (!mongoUrl || queries.length === 0) {
    return resultMap;
  }

  const client = new MongoClient(mongoUrl, MONGO_OPTS);

  try {
    const coll = client.db('lawdb').collection('articles');

    for (const { query, limit: rawLimit } of queries) {
      const limit = Math.min(Math.max(rawLimit || 5, 1), 50);

      try {
        const articleMatch = query.match(ARTICLE_REGEX);
        const lawConceptMatch = !articleMatch ? query.match(LAW_CONCEPT_REGEX) : null;

        // Strategy 0: Direct _id lookup
        if (articleMatch) {
          const rawLawName = articleMatch[1].trim();
          const rawArticle = articleMatch[2].trim();
          const resolvedName = resolveAlias(rawLawName);
          const normalizedArticle = normalizeArticleNo(rawArticle);
          const articleId = buildArticleId(resolvedName, normalizedArticle);

          if (articleId) {
            const doc = await coll.findOne({ _id: articleId } as Record<string, unknown>);
            if (doc) {
              resultMap.set(query, [
                {
                  ...doc,
                  url: buildUrl(doc.pcode as string),
                  score: 1,
                } as unknown as LawArticle,
              ]);
              continue;
            }
          }
        }

        // Strategy 1: Exact article regex
        if (articleMatch) {
          const rawLawName = articleMatch[1].trim();
          const articleQuery = articleMatch[2].trim();
          const resolvedName = resolveAlias(rawLawName);
          const numMatch = articleQuery.match(/第\s*(\d+)\s*(條.*)/);
          if (numMatch) {
            const articleNum = numMatch[1];
            const suffix = numMatch[2].replace(/條|\s+/g, '');
            const articleRegex = suffix
              ? new RegExp(`第\\s*${articleNum}[-\\s]*${suffix.replace(/之/g, '[-之]\\s*')}\\s*條`)
              : new RegExp(`第\\s*${articleNum}\\s*條(?!\\s*之)(?!.*-)`);
            const directResults = await coll
              .find({
                $or: [{ law_name: resolvedName }, { aliases: { $regex: resolvedName } }],
                article_no: { $regex: articleRegex },
              })
              .limit(limit)
              .toArray();

            if (directResults.length > 0) {
              resultMap.set(
                query,
                directResults.map((r) => ({
                  ...r,
                  url: buildUrl(r.pcode as string),
                  score: 1,
                })) as unknown as LawArticle[],
              );
              continue;
            }
          }
        }

        // Atlas Search fallback
        let compound: Record<string, unknown>;

        if (articleMatch) {
          const rawLawName = articleMatch[1].trim();
          const articleQuery = articleMatch[2].trim();
          const resolvedName = resolveAlias(rawLawName);
          compound = {
            must: [
              {
                text: {
                  query: resolvedName,
                  path: ['law_name', 'aliases'],
                  synonyms: 'law_synonyms',
                },
              },
            ],
            should: [{ text: { query: articleQuery, path: 'article_no' } }],
          };
        } else if (lawConceptMatch) {
          const rawLawName = lawConceptMatch[1];
          const resolvedName = resolveAlias(rawLawName);
          const concept = lawConceptMatch[2];
          compound = {
            must: [
              {
                text: {
                  query: resolvedName,
                  path: ['law_name', 'aliases'],
                  synonyms: 'law_synonyms',
                },
              },
            ],
            should: [
              {
                text: {
                  query: concept,
                  path: 'chapter',
                  synonyms: 'law_synonyms',
                  score: { boost: { value: 5 } },
                },
              },
              {
                text: {
                  query: concept,
                  path: 'content',
                  synonyms: 'law_synonyms',
                  score: { boost: { value: 3 } },
                },
              },
              {
                text: {
                  query: concept,
                  path: 'category',
                  synonyms: 'law_synonyms',
                },
              },
            ],
            minimumShouldMatch: 1,
          };
        } else {
          compound = {
            should: [
              {
                text: {
                  query,
                  path: ['law_name', 'aliases'],
                  synonyms: 'law_synonyms',
                  score: { boost: { value: 5 } },
                },
              },
              {
                text: {
                  query,
                  path: 'chapter',
                  synonyms: 'law_synonyms',
                  score: { boost: { value: 3 } },
                },
              },
              {
                text: {
                  query,
                  path: 'content',
                  synonyms: 'law_synonyms',
                },
              },
              {
                text: {
                  query,
                  path: 'category',
                  synonyms: 'law_synonyms',
                  score: { boost: { value: 0.5 } },
                },
              },
            ],
            minimumShouldMatch: 1,
          };
        }

        const results = await coll
          .aggregate([
            { $search: { index: 'law_search', compound } },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                pcode: 1,
                law_name: 1,
                nature: 1,
                category: 1,
                chapter: 1,
                article_no: 1,
                content: 1,
                aliases: 1,
                last_update: 1,
                url: {
                  $concat: ['https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=', '$pcode'],
                },
                score: { $meta: 'searchScore' },
              },
            },
          ])
          .toArray();

        resultMap.set(query, results as unknown as LawArticle[]);
      } catch {
        resultMap.set(query, []);
      }
    }

    return resultMap;
  } finally {
    await client.close().catch(() => {});
  }
};
