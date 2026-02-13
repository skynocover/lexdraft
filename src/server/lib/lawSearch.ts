import { MongoClient } from 'mongodb'

export interface LawArticle {
  _id: string
  pcode: string
  law_name: string
  nature: string
  category: string
  chapter: string
  article_no: string
  content: string
  aliases?: string
  last_update: string
  url: string
  score: number
}

const ARTICLE_REGEX = /^(.+?)\s*(第\s*\S+?\s*條.*)$/

export async function searchLaw(
  mongoUrl: string,
  opts: { query: string; limit?: number; nature?: string },
): Promise<LawArticle[]> {
  const { query, limit: rawLimit, nature } = opts
  const limit = Math.min(Math.max(rawLimit || 10, 1), 50)

  if (!mongoUrl) {
    console.warn('searchLaw: MONGO_URL not set')
    return []
  }

  // Create a fresh client per request — Workers/miniflare does not maintain
  // TCP sockets between requests, so pooled connections become stale and hang.
  const client = new MongoClient(mongoUrl, {
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  })

  try {
    const coll = client.db('lawdb').collection('articles')
    const articleMatch = query.match(ARTICLE_REGEX)

    let compound: Record<string, unknown>

    if (articleMatch) {
      const lawQuery = articleMatch[1].trim()
      const articleQuery = articleMatch[2].trim()
      compound = {
        must: [
          {
            text: {
              query: lawQuery,
              path: ['law_name', 'aliases'],
              synonyms: 'law_synonyms',
            },
          },
        ],
        should: [
          { text: { query: articleQuery, path: 'article_no' } },
        ],
      }
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
              path: 'content',
              synonyms: 'law_synonyms',
            },
          },
          {
            text: {
              query,
              path: ['category', 'chapter'],
              synonyms: 'law_synonyms',
              score: { boost: { value: 0.5 } },
            },
          },
        ],
        minimumShouldMatch: 1,
      }
    }

    if (nature) {
      (compound as Record<string, unknown>).filter = [
        { text: { query: nature, path: 'nature' } },
      ]
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
              $concat: [
                'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=',
                '$pcode',
              ],
            },
            score: { $meta: 'searchScore' },
          },
        },
      ])
      .toArray()

    return results as unknown as LawArticle[]
  } finally {
    await client.close().catch(() => {})
  }
}
