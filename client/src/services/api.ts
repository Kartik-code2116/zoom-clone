import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// --- Interfaces ---

export interface User {
  id: string;
  _id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Meeting {
  _id: string;
  meetingId: string;
  hostId: string;
  title: string;
  status: 'active' | 'ended';
  createdAt: string;
  endedAt?: string;
}

export interface MeetingToken {
  token: string;
}

export interface AuthResponse {
  user: User;
}

export interface MeetingResponse {
  meeting: Meeting;
}

export interface MeetingsListResponse {
  meetings: Meeting[];
}

export interface TokenResponse {
  token: string;
}

// --- Auth API ---

export const registerUser = async (
  name: string,
  email: string,
  password: string
): Promise<AuthResponse> => {
  const { data } = await api.post<AuthResponse>('/auth/register', {
    name,
    email,
    password,
  });
  return data;
};

export const loginUser = async (
  email: string,
  password: string
): Promise<AuthResponse> => {
  const { data } = await api.post<AuthResponse>('/auth/login', {
    email,
    password,
  });
  return data;
};

export const logoutUser = async (): Promise<{ message: string }> => {
  const { data } = await api.post<{ message: string }>('/auth/logout');
  return data;
};

export const getCurrentUser = async (): Promise<User> => {
  const { data } = await api.get<{ user: User }>('/auth/me');
  return data.user;
};

// --- Meetings API ---

export const createMeeting = async (): Promise<MeetingResponse> => {
  const { data } = await api.post<MeetingResponse>('/meetings');
  return data;
};

export const getMyMeetings = async (): Promise<MeetingsListResponse> => {
  const { data } = await api.get<MeetingsListResponse>('/meetings');
  return data;
};

export const getMeeting = async (meetingId: string): Promise<Meeting> => {
  const { data } = await api.get<{ meeting: Meeting }>(
    `/meetings/${meetingId}`
  );
  return data.meeting;
};

export const getMeetingToken = async (
  meetingId: string,
  identity: string,
  name: string
): Promise<TokenResponse> => {
  const { data } = await api.post<TokenResponse>(
    `/meetings/${meetingId}/token`,
    {
      identity,
      name,
    }
  );
  return data;
};

export const endMeeting = async (
  meetingId: string
): Promise<{ message: string }> => {
  const { data } = await api.post<{ message: string }>(
    `/meetings/${meetingId}/end`
  );
  return data;
};

export default api;
