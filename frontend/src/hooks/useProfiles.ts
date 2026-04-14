import { useState, useEffect } from 'react';
import { createLeappApi } from '@/lib/leappApi';
import { Profile } from '@/types/leapp';

export function useProfiles(tool: string) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const api = createLeappApi(tool);

  const fetchProfiles = async () => {
    setIsLoading(true);
    try {
      const data = await api.profiles.getAll();
      setProfiles(data);
    } catch (error) {
      console.error('Failed to load profiles:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadProfile = async (profileId: number) => {
    try {
      const data = await api.profiles.load(profileId);
      await fetchProfiles();
      return data;
    } catch (error) {
      console.error('Failed to load profile:', error);
      throw error;
    }
  };

  const saveProfile = async (name: string, modules: string[]) => {
    try {
      const data = await api.profiles.save(name, modules);
      await fetchProfiles();
      return data.name;
    } catch (error) {
      console.error('Failed to save profile:', error);
      throw error;
    }
  };

  const deleteProfile = async (profileId: number) => {
    try {
      const data = await api.profiles.delete(profileId);
      await fetchProfiles();
      return data.message;
    } catch (error) {
      console.error('Failed to delete profile:', error);
      throw error;
    }
  };

  useEffect(() => {
    fetchProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]); // Refetch when tool changes

  return {
    profiles,
    isLoading,
    fetchProfiles,
    loadProfile,
    saveProfile,
    deleteProfile,
  };
}