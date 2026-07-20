import { createContext, useContext, useState, type ReactNode } from "react";

type ActiveSectionContextValue = {
  activeSection: string | null;
  setActiveSection: (section: string | null) => void;
};

const ActiveSectionContext = createContext<ActiveSectionContextValue | null>(null);

export function ActiveSectionProvider({ children }: { children: ReactNode }) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  return (
    <ActiveSectionContext.Provider value={{ activeSection, setActiveSection }}>
      {children}
    </ActiveSectionContext.Provider>
  );
}

export function useActiveSection() {
  const ctx = useContext(ActiveSectionContext);
  if (!ctx) {
    throw new Error("useActiveSection must be used within ActiveSectionProvider");
  }
  return ctx;
}
