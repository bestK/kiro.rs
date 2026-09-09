import axios from 'axios'
import { storage } from '@/lib/storage'
import type {
  GroupsResponse,
  GroupQueryParams,
  GroupItem,
  CreateGroupRequest,
  UpdateGroupRequest,
  SuccessResponse,
} from '@/types/api'

const api = axios.create({
  baseURL: '/api/admin',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const apiKey = storage.getApiKey()
  if (apiKey) config.headers['x-api-key'] = apiKey
  return config
})

export async function listGroups(
  params?: GroupQueryParams,
): Promise<GroupsResponse> {
  const { data } = await api.get<GroupsResponse>('/groups', {
    params,
  })
  return data
}

export async function createGroup(req: CreateGroupRequest): Promise<GroupItem> {
  const { data } = await api.post<GroupItem>('/groups', req)
  return data
}

export async function updateGroup(
  name: string,
  req: UpdateGroupRequest,
): Promise<GroupItem> {
  // path 中的分组名可能含中文/空格，必须 encodeURIComponent
  const { data } = await api.patch<GroupItem>(`/groups/${encodeURIComponent(name)}`, req)
  return data
}

/** 删除分组。`force=true` 时级联清理所有引用（凭据 groups + 客户端 Key.group）。 */
export async function deleteGroup(name: string, force = false): Promise<SuccessResponse> {
  const path = `/groups/${encodeURIComponent(name)}${force ? '?force=true' : ''}`
  const { data } = await api.delete<SuccessResponse>(path)
  return data
}

/** 按字段条件预览匹配的凭据 */
export async function previewCredentialsFilter(
  req: import('@/types/api').PreviewFilterRequest,
): Promise<import('@/types/api').PreviewFilterResponse> {
  const { data } = await api.post<import('@/types/api').PreviewFilterResponse>(
    '/credentials/preview-filter',
    req,
  )
  return data
}

/** 按字段条件批量归入凭据到目标分组 */
export async function assignGroupCredentialsByFilter(
  name: string,
  req: import('@/types/api').AssignByFilterRequest,
): Promise<import('@/types/api').AssignByFilterResponse> {
  const { data } = await api.post<import('@/types/api').AssignByFilterResponse>(
    `/groups/${encodeURIComponent(name)}/assign-by-filter`,
    req,
  )
  return data
}
