import React, { createContext, useContext, useMemo } from "react";

type TabVisibilityContextValue = {
  hideBottomTabs: boolean;
};

const TabVisibilityContext = createContext<TabVisibilityContextValue>({
  hideBottomTabs: false,
});

export function TabVisibilityProvider({
  children,
  hideBottomTabs,
}: {
  children: React.ReactNode;
  hideBottomTabs: boolean;
}) {
  const value = useMemo(() => ({ hideBottomTabs }), [hideBottomTabs]);

  return (
    <TabVisibilityContext.Provider value={value}>
      {children}
    </TabVisibilityContext.Provider>
  );
}

export function useTabVisibility() {
  return useContext(TabVisibilityContext);
}
