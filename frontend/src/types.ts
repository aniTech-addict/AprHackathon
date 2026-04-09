export type InputCategory = 'descriptive' | 'vague'
export type Phase = 'input' | 'clarity' | 'planning' | 'review'

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
  segmentTitle: string
  content: string
  sources: ReviewSource[]
}

export interface ReviewPreviewResponse {
  sessionId: string
  planId: string
  topic: string
  planStatus: string
  paragraphs: ReviewParagraph[]
}
