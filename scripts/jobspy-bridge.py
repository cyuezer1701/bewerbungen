#!/usr/bin/env python3
"""Bridge script: calls JobSpy and outputs JSON to stdout."""
import json
import sys
from jobspy import scrape_jobs

def main():
    payload = json.loads(sys.stdin.read())
    keywords = payload.get("keywords", [])
    locations = payload.get("locations", [payload.get("location", "Switzerland")])
    max_results = payload.get("max_results", 20)
    sites = payload.get("sites", ["indeed", "glassdoor", "google"])
    hours_old = payload.get("hours_old", 72)
    country = payload.get("country", "Switzerland")

    all_jobs = []
    seen_ids = set()

    for loc in locations:
        for keyword in keywords:
            if len(all_jobs) >= max_results:
                break
            remaining = max_results - len(all_jobs)
            try:
                df = scrape_jobs(
                    site_name=sites,
                    search_term=keyword,
                    location=loc,
                    results_wanted=min(remaining, 10),
                    hours_old=hours_old,
                    country_indeed=country,
                )
                for _, row in df.iterrows():
                    job = {
                        "title": str(row.get("title", "")) if row.get("title") is not None else "",
                        "company": str(row.get("company_name", row.get("company", ""))) if row.get("company_name", row.get("company")) is not None else "",
                        "location": str(row.get("location", "")) if row.get("location") is not None else "",
                        "description": str(row.get("description", ""))[:5000] if row.get("description") is not None else "",
                        "source": str(row.get("site", "jobspy")),
                        "sourceId": str(row.get("id", row.get("job_url_direct", ""))) if row.get("id", row.get("job_url_direct")) is not None else "",
                        "sourceUrl": str(row.get("job_url", "")) if row.get("job_url") is not None else "",
                        "salaryMin": float(row["min_amount"]) if row.get("min_amount") is not None and str(row.get("min_amount")) != "nan" else None,
                        "salaryMax": float(row["max_amount"]) if row.get("max_amount") is not None and str(row.get("max_amount")) != "nan" else None,
                        "salaryCurrency": str(row.get("currency", "CHF")) if row.get("currency") is not None and str(row.get("currency")) != "nan" else "CHF",
                        "datePosted": str(row.get("date_posted", "")) if row.get("date_posted") is not None and str(row.get("date_posted")) != "nan" else None,
                        "isRemote": bool(row.get("is_remote", False)) if row.get("is_remote") is not None else False,
                    }
                    if job["title"] and job["sourceId"] and job["sourceId"] not in seen_ids:
                        seen_ids.add(job["sourceId"])
                        all_jobs.append(job)
            except Exception as e:
                print(json.dumps({"error": str(e), "keyword": keyword, "location": loc}), file=sys.stderr)
                continue

    json.dump(all_jobs, sys.stdout)


if __name__ == "__main__":
    main()
