import { getClerkToken } from './clerkAuth';

export const getAuthToken = async (): Promise<string | undefined> => {
  return getClerkToken();
};
