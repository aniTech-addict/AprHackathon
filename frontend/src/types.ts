export type InputCategory = 'descriptive' | 'vague'
export type Phase = 'input' | 'clarity' | 'planning' | 'review'

export interface SessionListItem {
  id: string
  topic: string
  inputCategory: InputCategory
  status: string
  latestPlanId: string | null
  createdAt: string
  updatedAt: string
}

export interface StartResearchResponse {
  sessionId: string
  topic: string
  inputCategory: InputCategory
  confidence: number
  reasoning: string
  nextStep: 'ask_clarity_questions' | 'generate_research_plan'
  followUpQuestions?: string[]
  clarityRound?: number
}

export interface ResearchSegment {
  order: number
  title: string
  topic: string
  searchQueries: string[]
}

export interface PlanningResponse {
  sessionId: string
  planId: string
  topic: string
  totalPages: number
  segmentCount: number
  segments: ResearchSegment[]
  planMarkdown: string
  status?: 'pending_approval' | 'approved'
}

export interface ResearchState {
  sessionId: string | null
  topic: string
  userBackground: 'researcher' | 'student' | 'teacher'
  researchGoal: string
  sourcePreferences: string[]
  endGoal: 'propose_solutions' | 'evaluate_and_explain' | 'explore_current_approaches'
  planData: PlanningResponse | null
}

export interface ReviewSource {
  id: string
  title: string
  url: string
  excerpt: string
}

export interface ReviewParagraph {
  id: string
  order: number
  segmentOrder: number
  paragraphIndex: number
  segmentTitle: string
  content: string
  sources: ReviewSource[]
}

export interface ReviewPage {
  segmentOrder: number
  segmentTitle: string
  topic: string
  paragraphs: ReviewParagraph[]
}

export interface ReviewPreviewResponse {
  sessionId: string
  planId: string
  topic: string
  planStatus: string
  approvedSegmentOrders: number[]
  pages: ReviewPage[]
  paragraphs: ReviewParagraph[]
}

export interface ReviewExportResponse {
  sessionId: string
  planId: string
  topic: string
  planStatus: string
  exportedAt: string
  pageCount: number
  paragraphCount: number
  sourceCount: number
  pages: Array<{
    segmentOrder: number
    segmentTitle: string
    topic: string
    paragraphs: Array<{
      id: string
      order: number
      paragraphIndex: number
      content: string
    }>
  }>
  paragraphs: Array<{
    id: string
    order: number
    segmentOrder: number
    paragraphIndex: number
    segmentTitle: string
    content: string
    citations: Array<{
      sourceId: string
      title: string
      url: string
      excerpt: string
    }>
  }>
  sources: Array<{
    id: string
    title: string
    url: string
    excerpt: string
    paragraphId: string
    paragraphOrder: number
  }>
}
