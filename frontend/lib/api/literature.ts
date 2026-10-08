import { apiRequest } from "./client";

export type LiteratureSourceInput = { authors:string[]; year?:number|null; title:string; source_type:string; journal_or_publisher?:string|null; volume?:string|null; issue?:string|null; pages?:string|null; doi?:string|null; url?:string|null; abstract?:string|null; keywords:string[]; verified:boolean };
export type EvidenceInput = { source_id:string; finding:string; population?:string|null; setting?:string|null; method?:string|null; sample_size?:number|null; limitations:string[]; notes?:string|null };
export type ClaimInput = { text:string; evidence_ids:string[]; source_ids:string[]; confidence?:string|null };
export type LiteratureSource = LiteratureSourceInput & { source_id:string };
export type EvidenceItem = EvidenceInput & { evidence_id:string };
export type LiteratureClaim = ClaimInput & { claim_id:string };
export type LiteratureWorkspace = { sources:LiteratureSource[]; evidence_items:EvidenceItem[]; claims:LiteratureClaim[]; research_gap:string; synthesis:string };

export async function addLiteratureSource(projectId:string,input:LiteratureSourceInput){return apiRequest<{status:string;source:LiteratureSource}>(`/api/projects/${projectId}/literature/sources`,{method:"POST",body:JSON.stringify(input)})}
export async function addEvidenceItem(projectId:string,input:EvidenceInput){return apiRequest<{status:string;evidence:EvidenceItem}>(`/api/projects/${projectId}/literature/evidence`,{method:"POST",body:JSON.stringify(input)})}
export async function addLiteratureClaim(projectId:string,input:ClaimInput){return apiRequest<{status:string;claim:LiteratureClaim}>(`/api/projects/${projectId}/literature/claims`,{method:"POST",body:JSON.stringify(input)})}
export async function getLiteratureWorkspace(projectId:string):Promise<LiteratureWorkspace>{const r=await apiRequest<{content:Record<string,unknown>}>(`/api/projects/${projectId}/modules/literature_evidence`);return{sources:Array.isArray(r.content.sources)?r.content.sources as LiteratureSource[]:[],evidence_items:Array.isArray(r.content.evidence_items)?r.content.evidence_items as EvidenceItem[]:[],claims:Array.isArray(r.content.claims)?r.content.claims as LiteratureClaim[]:[],research_gap:String(r.content.research_gap||""),synthesis:String(r.content.synthesis||"")}}
export async function saveLiteratureWorkspace(projectId:string,workspace:LiteratureWorkspace){return apiRequest<{status:string;content:Record<string,unknown>}>(`/api/projects/${projectId}/modules/literature_evidence`,{method:"PUT",body:JSON.stringify({content:workspace})})}
