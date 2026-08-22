import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Badge } from "./badge";
import { Button } from "./button";
import { AlertDialog, AlertDialogTrigger } from "./alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { DropdownMenu, DropdownMenuTrigger } from "./dropdown-menu";
import { Input } from "./input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "./pagination";
import { Select, SelectTrigger, SelectValue } from "./select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "./sheet";
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "./sidebar";
import { Tabs, TabsList, TabsTrigger } from "./tabs";
import { Tooltip, TooltipProvider, TooltipTrigger } from "./tooltip";

const buttonSizes = ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const;

function expectMinimumInteractiveTarget(element: HTMLElement) {
  expect(element).toHaveClass("min-h-11", "min-w-11");
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      matches: true,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  document.cookie = "sidebar_state=; path=/; max-age=0";
  vi.unstubAllGlobals();
});

describe("44px interactive target contract", () => {
  it.each(buttonSizes)("keeps the %s button hit area at least 44px", (size) => {
    render(<Button size={size}>행동</Button>);
    expectMinimumInteractiveTarget(screen.getByRole("button", { name: "행동" }));
  });

  it("keeps form and tab controls at least 44px", () => {
    render(
      <>
        <Input aria-label="이름" />
        <Select>
          <SelectTrigger aria-label="역할">
            <SelectValue placeholder="역할" />
          </SelectTrigger>
        </Select>
        <Tabs defaultValue="first">
          <TabsList>
            <TabsTrigger value="first">첫 탭</TabsTrigger>
          </TabsList>
        </Tabs>
      </>,
    );

    expectMinimumInteractiveTarget(screen.getByRole("textbox", { name: "이름" }));
    expectMinimumInteractiveTarget(screen.getByRole("combobox", { name: "역할" }));
    expectMinimumInteractiveTarget(screen.getByRole("tab", { name: "첫 탭" }));
  });

  it("keeps a linked badge at least 44px without enlarging status-only badges", () => {
    render(
      <>
        <Badge asChild>
          <a href="#details">상세 보기</a>
        </Badge>
        <Badge>출석</Badge>
      </>,
    );

    expectMinimumInteractiveTarget(screen.getByRole("link", { name: "상세 보기" }));
    expect(screen.getByText("출석")).not.toHaveClass("min-h-11", "min-w-11");
  });

  it("keeps dialog and sheet close controls at least 44px", () => {
    const dialog = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>대화상자</DialogTitle>
          <DialogDescription>설명</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expectMinimumInteractiveTarget(screen.getByRole("button", { name: "Close" }));
    dialog.unmount();

    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>시트</SheetTitle>
          <SheetDescription>설명</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    expectMinimumInteractiveTarget(screen.getByRole("button", { name: "Close" }));
  });

  it("keeps pagination and sidebar controls at least 44px", () => {
    const { container } = render(
      <>
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationLink href="#page">1</PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
        <SidebarProvider>
          <SidebarTrigger />
          <SidebarRail />
          <SidebarGroupAction aria-label="그룹 행동" />
          <SidebarMenuButton>메뉴</SidebarMenuButton>
          <SidebarMenuAction aria-label="메뉴 행동" />
          <SidebarMenuSubButton href="#sub">하위 메뉴</SidebarMenuSubButton>
        </SidebarProvider>
      </>,
    );

    [
      "pagination-link",
      "sidebar-trigger",
      "sidebar-rail",
      "sidebar-group-action",
      "sidebar-menu-button",
      "sidebar-menu-action",
      "sidebar-menu-sub-button",
    ].forEach((slot) => {
      const element = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
      expect(element, `${slot} should render`).not.toBeNull();
      expectMinimumInteractiveTarget(element!);
    });
  });

  it("keeps directly rendered primitive triggers and close controls at least 44px", () => {
    const { container } = render(
      <>
        <AlertDialog>
          <AlertDialogTrigger>경고 열기</AlertDialogTrigger>
        </AlertDialog>
        <Dialog>
          <DialogTrigger>대화상자 열기</DialogTrigger>
          <DialogClose>대화상자 닫기</DialogClose>
        </Dialog>
        <Sheet>
          <SheetTrigger>시트 열기</SheetTrigger>
          <SheetClose>시트 닫기</SheetClose>
        </Sheet>
        <DropdownMenu>
          <DropdownMenuTrigger>메뉴 열기</DropdownMenuTrigger>
        </DropdownMenu>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>도움말 열기</TooltipTrigger>
          </Tooltip>
        </TooltipProvider>
      </>,
    );

    [
      "alert-dialog-trigger",
      "dialog-trigger",
      "dialog-close",
      "sheet-trigger",
      "sheet-close",
      "dropdown-menu-trigger",
      "tooltip-trigger",
    ].forEach((slot) => {
      const element = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
      expect(element, `${slot} should render`).not.toBeNull();
      expectMinimumInteractiveTarget(element!);
    });
  });
});

describe("responsive and focus source contracts", () => {
  const uiDirectory = path.join(process.cwd(), "src/components/ui");
  const sidebarSource = readFileSync(path.join(uiDirectory, "sidebar.tsx"), "utf8");
  const globalSource = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const focusSources = readdirSync(uiDirectory)
    .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
    .map((file) => readFileSync(path.join(uiDirectory, file), "utf8"))
    .join("\n");

  it("uses Tailwind lg utilities for the 64rem sidebar switch", () => {
    expect(sidebarSource).toContain("lg:block");
    expect(sidebarSource).toContain("lg:flex");
    expect(sidebarSource).not.toMatch(/\bmd:/);
  });

  it("uses solid focus indicators without translucent ring tokens", () => {
    expect(focusSources).not.toMatch(/ring-(?:ring|destructive)\/\d+/);
    expect(globalSource).not.toMatch(/outline-ring\/\d+/);
  });
});

describe("sidebar 44px target geometry", () => {
  it("centers the 44px rail hit box on either sidebar boundary", () => {
    const { container } = render(
      <SidebarProvider>
        <SidebarRail />
      </SidebarProvider>,
    );
    const rail = container.querySelector<HTMLElement>('[data-slot="sidebar-rail"]');

    expect(rail).toHaveClass(
      "w-11",
      "min-h-11",
      "min-w-11",
      "group-data-[side=left]:-right-5.5",
      "group-data-[side=right]:-left-5.5",
      "after:start-[calc(50%-1px)]",
    );
    expect(rail).not.toHaveClass(
      "w-4",
      "after:start-1/2",
      "ltr:-translate-x-1/2",
      "rtl:-translate-x-1/2",
    );
  });

  it("reserves a 44px group header row and text gutter for its action", () => {
    const { container } = render(
      <SidebarProvider>
        <SidebarGroup>
          <SidebarGroupLabel>분반</SidebarGroupLabel>
          <SidebarGroupAction aria-label="분반 행동" />
        </SidebarGroup>
      </SidebarProvider>,
    );
    const group = container.querySelector<HTMLElement>('[data-slot="sidebar-group"]');
    const label = container.querySelector<HTMLElement>('[data-slot="sidebar-group-label"]');
    const action = container.querySelector<HTMLElement>('[data-slot="sidebar-group-action"]');

    expect(group).toHaveClass(
      "group/sidebar-group",
      "has-data-[sidebar=group-action]:min-h-15",
      "group-data-[collapsible=icon]:min-h-0",
    );
    expect(label).toHaveClass(
      "h-11",
      "group-data-[collapsible=icon]:-mt-11",
      "group-has-data-[sidebar=group-action]/sidebar-group:pr-12",
    );
    expect(label).not.toHaveClass("min-h-11", "min-w-11");
    expect(action).toHaveClass("top-2", "right-2", "size-11", "min-h-11", "min-w-11");
  });

  it("reserves menu text space and centers its 44px action in each row size", () => {
    const { container } = render(
      <SidebarProvider>
        <SidebarMenuItem>
          <SidebarMenuButton>출석 메뉴</SidebarMenuButton>
          <SidebarMenuAction aria-label="메뉴 행동" />
        </SidebarMenuItem>
      </SidebarProvider>,
    );
    const button = container.querySelector<HTMLElement>('[data-slot="sidebar-menu-button"]');
    const action = container.querySelector<HTMLElement>('[data-slot="sidebar-menu-action"]');

    expect(button).toHaveClass("group-has-data-[sidebar=menu-action]/menu-item:pr-12");
    expect(action).toHaveClass(
      "top-0",
      "right-0",
      "size-11",
      "min-h-11",
      "min-w-11",
      "peer-data-[size=lg]/menu-button:top-0.5",
    );
  });
});

describe("sidebar keyboard shortcut", () => {
  it("preserves the default Cmd+B toggle and state cookie for collapsible consumers", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>메뉴</Sidebar>
      </SidebarProvider>,
    );
    const sidebar = container.querySelector<HTMLElement>('[data-slot="sidebar"][data-state]');
    const shortcut = new KeyboardEvent("keydown", {
      key: "b",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    fireEvent(window, shortcut);

    expect(shortcut.defaultPrevented).toBe(true);
    expect(sidebar).toHaveAttribute("data-state", "collapsed");
    expect(document.cookie).toContain("sidebar_state=false");
  });
});
