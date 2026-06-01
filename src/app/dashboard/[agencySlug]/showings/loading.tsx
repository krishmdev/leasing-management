// Only on segments without record pages below them: a Suspense boundary above a page that
// calls notFound() would make the response a 200.
export { DeskLoading as default } from "@/components/desk/DeskLoading";
