"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";

interface AuthContextType {
  isAuthenticated: boolean;
  licenseKey: string | null;
  domain: string | null;
  login: (licenseKey: string, domain: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);

  useEffect(() => {
    // Check for existing auth on mount
    checkAuth();
  }, []);

  const checkAuth = () => {
    const token = localStorage.getItem("authToken");
    const storedLicense = localStorage.getItem("licenseKey");
    const storedDomain = localStorage.getItem("domain");

    if (token && storedLicense && storedDomain) {
      // Verify token is still valid (you could decode and check expiry)
      setIsAuthenticated(true);
      setLicenseKey(storedLicense);
      setDomain(storedDomain);
      return true;
    }
    
    setIsAuthenticated(false);
    return false;
  };

  const login = async (licenseKey: string, domain: string): Promise<boolean> => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ licenseKey, domain }),
      });

      if (response.ok) {
        const data = await response.json();
        
        // Store auth data
        localStorage.setItem("authToken", data.token);
        localStorage.setItem("licenseKey", licenseKey);
        localStorage.setItem("domain", domain);
        
        // Set cookies for server-side auth
        document.cookie = `authToken=${data.token}; path=/; max-age=${30 * 24 * 60 * 60}`; // 30 days
        
        setIsAuthenticated(true);
        setLicenseKey(licenseKey);
        setDomain(domain);
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error("Login error:", error);
      return false;
    }
  };

  const logout = () => {
    // Clear all auth data
    localStorage.removeItem("authToken");
    localStorage.removeItem("licenseKey");
    localStorage.removeItem("domain");
    
    // Clear cookie
    document.cookie = "authToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    
    setIsAuthenticated(false);
    setLicenseKey(null);
    setDomain(null);
    
    // Redirect to login
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      licenseKey,
      domain,
      login,
      logout,
      checkAuth
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}