import { useState, useRef, useEffect } from 'react';
import { Button, Input, Dropdown, ConfirmDialog } from '@/components/ui';
import { useProfiles, useDropdown, useConfirmDialog } from '../../hooks';
import { Module } from '../../types/leapp';
import { useLeapp } from '@/context/LeappContext';
import { Trash2 } from 'lucide-react';

const slowModules = new Set([
  'photosMetadata',
  'walStrings',
  'Ph9BurstAvalanche',
  'Ph10AssetParsedEmbeddedFiles',
  'Ph15PeopleandDetFacesNAD',
  'Ph16AssetPeopleandDetFaces',
  'Ph21AlbumsNonSharedNAD',
  'Ph22AssetsInNonSharedAlbums',
  'Ph23AlbumsSharedNAD',
  'Ph24AssetsInSharedAlbums',
  'Ph26SyndicationPLAssets',
  'Ph31iCloudSharePhotoLibraryNAD',
  'Ph32AssetsIniCldSPLwContrib',
  'Ph33AssetsIniCldSPLfromOtherContrib',
  'Ph34iCloudSharedLinksNAD',
  'Ph35iCloudSharedLinkAssets',
  'Ph50AssetIntResouData',
  'Ph51PossOptimizedAssetsIntResouData',
  'Ph70UserAdjustDateTimezoneLocation',
  'Ph94Ios14REFforAssetAnalysis',
  'Ph95iOS15REFforAssetAnalysis',
  'Ph96iOS16REFforAssetAnalysis',
  'Ph97iOS17REFforAssetAnalysis',
  'Ph98iOS18REFforAssetAnalysis'
]);

interface ModuleSelectorProps {
  tool: 'ileapp' | 'aleapp';
  isProcessing?: boolean;
}

export default function ModuleSelector({ tool, isProcessing }: ModuleSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [profileNameInput, setProfileNameInput] = useState('');
  const confirmDialog = useConfirmDialog();

  const {
    isOpen: isLoadProfileOpen,
    close: closeLoadProfile,
    handleClick: handleLoadProfileClick,
    buttonRef: loadProfileButtonRef
  } = useDropdown();

  const {
    isOpen: isSaveProfileOpen,
    close: closeSaveProfile,
    handleClick: handleSaveProfileClick,
    buttonRef: saveProfileButtonRef
  } = useDropdown();

  const { states, toggleModule, selectAll, selectNone, updateConfig } = useLeapp();
  const toolState = states[tool];
  const { modules, isLoadingModules } = toolState;
  const { artifactScrollPos } = toolState.config;
  const selectedModules = new Set(toolState.config.selectedModules || []);
  const { profiles, loadProfile, saveProfile, deleteProfile } = useProfiles(tool);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  // Restore scroll position
  useEffect(() => {
    if (scrollRef.current && modules.length > 0 && !isLoadingModules) {
      const currentScroll = scrollRef.current.scrollTop;
      // Only update if the difference is significant
      if (Math.abs(currentScroll - artifactScrollPos) > 1) {
        isSyncingScroll.current = true;
        scrollRef.current.scrollTop = artifactScrollPos;
        // Reset after a short delay to allow the browser to process the scroll event
        setTimeout(() => {
          isSyncingScroll.current = false;
        }, 50);
      }
    }
  }, [artifactScrollPos, modules.length, isLoadingModules]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingScroll.current) return;
    const target = e.currentTarget;
    const newPos = target.scrollTop;
    // Only update if it changed from the last known state position
    if (Math.abs(newPos - artifactScrollPos) > 1) {
      // Debounce the update to context to prevent choppy rendering during scroll
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        updateConfig(tool, { artifactScrollPos: newPos });
        scrollTimeoutRef.current = null;
      }, 150); // 150ms delay is enough to feel snappy but avoid render spam
    }
  };

  const handleLoadProfile = async (profileId: number) => {
    try {
      const data = await loadProfile(profileId);
      // Update local artifact selection from loaded profile
      updateConfig(tool, { selectedModules: data.modules });
      // Profile loaded successfully
      closeLoadProfile();
    } catch (error) {
      console.error('Failed to load profile:', error);
    }
  };

  const handleSaveProfile = async () => {
    const trimmedName = profileNameInput.trim();
    if (!trimmedName) {
      console.warn('Please enter a profile name');
      return;
    }

    try {
      await saveProfile(trimmedName, Array.from(selectedModules));
      setProfileNameInput('');
      closeSaveProfile();
    } catch (error) {
      console.error('Failed to save profile:', error);
    }
  };

  const handleDeleteProfile = (profileId: number) => {
    confirmDialog.show({
      title: 'Delete Profile',
      message: 'Are you sure you want to delete this profile? This cannot be undone.',
      variant: 'destructive',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await deleteProfile(profileId);
        } catch (error) {
          console.error('Failed to delete profile:', error);
        }
      }
    });
  };

  const filteredModules = modules.filter(module =>
    searchQuery === '' ||
    module.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    module.module_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    module.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const modulesByCategory = filteredModules.reduce((acc, module) => {
    if (!acc[module.category]) acc[module.category] = [];
    acc[module.category].push(module);
    return acc;
  }, {} as Record<string, Module[]>);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1 relative -top-[3px]">Artifact Selection</label>

      <div className="flex items-center justify-between mb-3 gap-4">
        <div className="flex gap-3 shrink-0">
          <div className="relative">
            <Button
              ref={loadProfileButtonRef as React.RefObject<HTMLButtonElement>}
              onClick={handleLoadProfileClick}
              disabled={isProcessing}
              variant="secondary"
              size="sm"
              className="text-xs"
            >
              Load Profile
            </Button>

            <Dropdown
              isOpen={isLoadProfileOpen}
              onClose={closeLoadProfile}
              align="left"
              buttonRef={loadProfileButtonRef as React.RefObject<HTMLButtonElement>}
              className="min-w-[200px] whitespace-nowrap bg-[#1A1A1A] border border-[#333] rounded-lg shadow-xl overflow-hidden"
            >
              <div className="bg-[#212121] px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-[#333]">
                Saved Profiles
              </div>
              <div className="max-h-[200px] overflow-y-auto custom-scrollbar bg-[#1A1A1A]">
                {profiles.length > 0 ? (
                  profiles.map((profile) => (
                    <div key={profile.id} className="flex items-center hover:bg-[#2a2a2a] transition-colors border-b border-[#262626] last:border-b-0">
                      <div
                        onClick={() => handleLoadProfile(profile.id)}
                        className="flex-1 px-3 py-2 text-left text-xs font-medium text-gray-300 hover:text-white cursor-pointer truncate"
                      >
                        {profile.name}
                      </div>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProfile(profile.id);
                        }}
                        className="px-3 py-2 text-gray-500 hover:text-red-400 transition-colors cursor-pointer"
                        title="Delete profile"
                      >
                        <Trash2 size={12} />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-8 text-xs text-gray-500 text-center">
                    No saved profiles
                  </div>
                )}
              </div>
            </Dropdown>
          </div>

          <div className="relative">
            <Button

              ref={saveProfileButtonRef as React.RefObject<HTMLButtonElement>}
              onClick={handleSaveProfileClick}
              disabled={isProcessing}
              variant="secondary"
              size="sm"
              className="text-xs"
            >
              Save Profile
            </Button>

            <Dropdown
              isOpen={isSaveProfileOpen}
              onClose={closeSaveProfile}
              align="left"
              buttonRef={saveProfileButtonRef as React.RefObject<HTMLButtonElement>}
              className="min-w-[220px] bg-[#1A1A1A] border border-[#333] rounded-lg shadow-xl overflow-hidden"
            >
              <div className="bg-[#212121] px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-[#333]">
                Create Profile
              </div>
              <div className="p-3 bg-[#1A1A1A]">
                <Input
                  value={profileNameInput}
                  onChange={(e) => setProfileNameInput(e.target.value)}
                  disabled={isProcessing}
                  placeholder="Profile name..."
                  className="w-full h-8 mb-2 text-[11px]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveProfile}
                    disabled={isProcessing || !profileNameInput.trim()}
                    className="flex-1 h-7 bg-[#333333] text-white rounded text-[11px] font-medium hover:bg-[#404040] transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-white/5"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      closeSaveProfile();
                      setProfileNameInput('');
                    }}
                    disabled={isProcessing}
                    className="flex-1 h-7 bg-[#262626] text-gray-400 rounded text-[11px] font-medium hover:bg-[#333333] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-[#333]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Dropdown>
          </div>
        </div>

        <div className="flex-1 max-w-xs">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={isProcessing}
            placeholder="Search modules..."
            className="w-full h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-lg border flex flex-col"
        style={{ backgroundColor: '#171717', borderColor: '#333333' }}>

        {/* Selection Controls Header - Sticky in visual sense but at top of box */}
        <div className="px-3 py-2 border-b border-[#333333] bg-[#1A1A1A] flex items-center justify-between shrink-0">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            Selection: <span className="text-white ml-1">{selectedModules.size}/{modules.length}</span>
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => selectAll(tool)}
              disabled={isProcessing}
              className="text-[10px] font-bold text-gray-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-[#262626] uppercase tracking-wider"
            >
              All
            </button>
            <button
              onClick={() => selectNone(tool)}
              disabled={isProcessing}
              className="text-[10px] font-bold text-gray-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-[#262626] uppercase tracking-wider"
            >
              None
            </button>
          </div>
        </div>

        <div className="relative flex-1 min-h-0">
          {/* Top/Bottom Fade Mask */}
          <div className="absolute inset-0 pointer-events-none z-10 scroll-mask" />
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="absolute inset-0 p-3 pt-6 pb-6 overflow-y-auto custom-scrollbar smooth-scroll"
          >
            {Object.entries(modulesByCategory).map(([category, categoryModules]) => (
              <div key={category} className="mb-2">
                <div className="text-xs font-medium text-gray-400 mb-1">
                  {category}
                </div>
                <div className="space-y-0.5">
                  {categoryModules.map((module) => (
                    <label
                      key={module.name}
                      className="flex items-center space-x-2 px-2 py-0.5 rounded hover:bg-[#262626] cursor-pointer transition-colors"
                    >
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={selectedModules.has(module.name)}
                          onChange={() => toggleModule(tool, module.name, !selectedModules.has(module.name))}
                          disabled={isProcessing}
                          className="w-3.5 h-3.5 rounded border border-white focus:ring-1 focus:ring-gray-600 appearance-none"
                          style={{ borderWidth: '0.5px', backgroundColor: selectedModules.has(module.name) ? '#262626' : 'transparent' }}
                        />
                        {selectedModules.has(module.name) && (
                          <svg className="absolute w-2.5 h-2.5 text-white pointer-events-none" style={{ top: '5.5px', left: '2px' }} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <span className="text-xs flex-1 text-white">{module.display_name}</span>
                      {slowModules.has(module.module_name) && (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0 rounded border border-white"
                          style={{ borderWidth: '0.5px', backgroundColor: '#262626', color: 'white' }}
                        >
                          Slow
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ConfirmDialog config={confirmDialog.config} onClose={confirmDialog.hide} onConfirm={confirmDialog.handleConfirm} />
    </div>
  );
}
