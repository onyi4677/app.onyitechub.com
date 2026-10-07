export type Project = {
  id: string;
  title: string;
  question: string;
  discipline: string;
  status: string;
  modules?: Record<string, unknown>;
};

export type ResearchModule = {
  name: string;
  description: string;
  status: string;
};
