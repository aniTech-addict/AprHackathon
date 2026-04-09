export type InputCategory = 'descriptive' | 'vague'
export type Phase = 'input' | 'clarity' | 'planning'

export interface StartResearchResponse {
  sessionId: string
  topic: string
  inputCategory: InputCategory
  confidence: number
  reasoning: string
  nextStep: 'ask_clarity_questions' | 'generate_research_plan'
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
  totalPages: number
  segmentCount: number
  segments: ResearchSegment[]
  planMarkdown: string
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
