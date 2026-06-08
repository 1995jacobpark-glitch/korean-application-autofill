function normalize(value) {
  return String(value || "")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return normalize(value).replace(/\s/g, "");
}

function cleanValue(value) {
  return normalize(value).replace(/^[-•◦]\s*/, "");
}

function parseTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];
  let current = [];
  const flush = () => {
    if (current.length) {
      tables.push(current);
      current = [];
    }
  };

  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cleanValue(cell));
      const isDivider = cells.every((cell) => /^:?-{2,}:?$/.test(cell));
      if (!isDivider) current.push(cells);
    } else {
      flush();
    }
  }
  flush();
  return tables;
}

function findNextCell(row, labelPatterns) {
  const labels = Array.isArray(labelPatterns) ? labelPatterns : [labelPatterns];
  for (let i = 0; i < row.length; i += 1) {
    const cell = compact(row[i]);
    if (labels.some((label) => cell.includes(compact(label)))) {
      return row[i + 1] || "";
    }
  }
  return "";
}

function tableHasHeaders(table, headers) {
  return table.some((row) => {
    const joined = compact(row.join(" "));
    return headers.every((header) => joined.includes(compact(header)));
  });
}

function getRowsAfterHeader(table, headers) {
  const index = table.findIndex((row) => {
    const joined = compact(row.join(" "));
    return headers.every((header) => joined.includes(compact(header)));
  });
  if (index < 0) return [];
  return table.slice(index + 1).filter((row) => row.some((cell) => cleanValue(cell)));
}

function parseKeyValueLines(markdown) {
  const pairs = [];
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => cleanValue(line.replace(/\*\*/g, "")))
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("|") || /^-+$/.test(line)) continue;
    const match = line.match(/^([가-힣A-Za-z0-9\s/()·._-]{1,24})\s*[:：]\s*(.+)$/);
    if (!match) continue;
    const label = compact(match[1]).replace(/[()]/g, "");
    const value = cleanValue(match[2]);
    if (label && value) pairs.push({ label, value });
  }
  return pairs;
}

function splitListValue(value) {
  return value
    .split(/[,，;；、]/)
    .map((item) => cleanValue(item))
    .filter(Boolean);
}

function applyPlainTextProfile(profile, markdown) {
  const pairs = parseKeyValueLines(markdown);
  for (const { label, value } of pairs) {
    if (/^(이름|성명|한글성명)$/.test(label) && !profile.person.nameKo) {
      profile.person.nameKo = value;
      continue;
    }
    if (/^(영문|영문명|영문성명|Name)$/i.test(label) && !profile.person.nameEn) {
      profile.person.nameEn = value;
      continue;
    }
    if (/^(생년월일|생일|출생일)$/.test(label) && !profile.person.birthDate) {
      profile.person.birthDate = value;
      continue;
    }
    if (/^(전화번호|연락처|핸드폰|휴대폰|휴대전화|휴대전화번호|휴대폰번호)$/.test(label)) {
      if (!profile.person.mobile || /^010[-\s]/.test(value)) profile.person.mobile = value;
      if (!profile.person.phoneHome && !/^010[-\s]/.test(value)) profile.person.phoneHome = value;
      continue;
    }
    if (/^(이메일|메일|email|e-mail)$/i.test(label) && !profile.person.email) {
      profile.person.email = value;
      continue;
    }
    if (/^(주소|자택주소|거주지|현주소)$/.test(label) && !profile.person.addressHome) {
      profile.person.addressHome = value;
      continue;
    }
    if (/^(현직장|직장|회사|회사명|직장명|소속|소속기관)$/.test(label) && !profile.work.company) {
      profile.work.company = value;
      continue;
    }
    if (/^(직위|직급|직책|담당업무)$/.test(label) && !profile.work.position) {
      profile.work.position = value;
      continue;
    }
    if (/^(학력|최종학력)$/.test(label) && profile.education.length === 0) {
      profile.education.push({
        period: "",
        school: "",
        major: "",
        degree: value,
        location: "",
      });
      continue;
    }
    if (/^(자격증|자격|보유자격|면허|면허증)$/.test(label) && profile.licenses.length === 0) {
      for (const name of splitListValue(value)) {
        profile.licenses.push({
          name,
          acquiredDate: "",
          number: "",
          issuer: "",
          note: "",
        });
      }
    }
  }

  const phoneMatch = markdown.match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/);
  if (phoneMatch && !profile.person.mobile) profile.person.mobile = phoneMatch[0];

  const emailMatch = markdown.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch && !profile.person.email) profile.person.email = emailMatch[0];
}

function extractProfileFromMarkdown(markdown) {
  const tables = parseTables(markdown);
  const profile = {
    person: {
      nameKo: "",
      nameEn: "",
      birthDate: "",
      phoneHome: "",
      mobile: "",
      email: "",
      addressHome: "",
    },
    work: {
      company: "",
      position: "",
      rank: "",
      address: "",
      phone: "",
      fax: "",
    },
    education: [],
    licenses: [],
    careers: [],
    committees: [],
    awards: [],
    projects: [],
    abilities: {},
    missing: [],
  };

  applyPlainTextProfile(profile, markdown);

  for (const table of tables) {
    const joined = table.flat().join(" ");

    if (joined.includes("(한글)") || joined.includes("E-mail") || joined.includes("휴 대 폰")) {
      for (const row of table) {
        for (const cell of row) {
          const ko = cell.match(/\(한글\)\s*(.+)$/);
          const en = cell.match(/\(영문\)\s*(.+)$/);
          if (ko) profile.person.nameKo = cleanValue(ko[1]);
          if (en) profile.person.nameEn = cleanValue(en[1]);
        }
        const birth = findNextCell(row, "생년월일");
        const email = findNextCell(row, ["E-mail", "Email", "이메일"]);
        const phone = findNextCell(row, "전화번호");
        const mobile = findNextCell(row, ["휴대폰", "휴 대 폰"]);
        const address = findNextCell(row, ["주소", "주 소"]);
        if (birth) profile.person.birthDate = birth;
        if (email) profile.person.email = email;
        if (phone) profile.person.phoneHome = phone;
        if (mobile) profile.person.mobile = mobile;
        if (address) profile.person.addressHome = address;
      }
    }

    if (tableHasHeaders(table, ["기간", "학교", "학과"])) {
      profile.education = getRowsAfterHeader(table, ["기간", "학교", "학과"])
        .map((row) => ({
          period: row[0] || "",
          school: row[1] || "",
          major: row[2] || "",
          degree: row[3] || "",
          location: row[4] || "",
        }))
        .filter((item) => item.school || item.degree || item.major);
    }

    if (tableHasHeaders(table, ["자격증명", "취득년월일"])) {
      profile.licenses = getRowsAfterHeader(table, ["자격증명", "취득년월일"])
        .map((row) => ({
          name: row[0] || "",
          acquiredDate: row[1] || "",
          number: row[2] || "",
          issuer: row[3] || "",
          note: "",
        }))
        .filter((item) => item.name);
    }

    if (tableHasHeaders(table, ["기간", "근무처", "직위", "담당업무"])) {
      const rows = getRowsAfterHeader(table, ["기간", "근무처", "직위", "담당업무"]);
      let inExtra = false;
      for (const row of rows) {
        const joinedRow = compact(row.join(" "));
        if (joinedRow.includes("기타경력사항") || joinedRow === "구분내용") {
          inExtra = true;
          continue;
        }
        if (inExtra) {
          if (row[0] || row[1]) {
            profile.committees.push({ period: row[0] || "", content: row[1] || "" });
          }
          continue;
        }
        if (row[1]) {
          profile.careers.push({
            period: row[0] || "",
            organization: row[1] || "",
            position: row[2] || "",
            duty: row[3] || "",
            leaveReason: row[4] || "",
          });
        }
      }
    }

    if (joined.includes("어학능력") || joined.includes("컴퓨터활용능력")) {
      for (const row of table) {
        const key = compact(row[0] || "");
        if (key.includes("어학능력")) profile.abilities.language = row[1] || "";
        if (key.includes("컴퓨터활용능력")) profile.abilities.computer = row[1] || "";
        if (key.includes("수상실적")) profile.awards.push(row[1] || "");
      }
    }

    if (joined.includes("<해외사업") || joined.includes("주요참여 프로젝트")) {
      const text = table.flat().join("\n");
      if (text.length > 30) profile.projects.push({ title: "주요참여 프로젝트 및 담당분야", content: text });
    }
  }

  const currentCareer =
    profile.careers.find((item) => /현재/.test(item.period)) ||
    profile.careers[profile.careers.length - 1] ||
    {};
  profile.work.company = currentCareer.organization || profile.work.company || "";
  profile.work.position = currentCareer.position || profile.work.position || "";
  if (/^[가-힣\s]+$/.test(profile.person.nameKo)) {
    profile.person.nameKo = profile.person.nameKo.replace(/\s+/g, "");
  }

  const required = [
    ["person.nameKo", profile.person.nameKo],
    ["person.birthDate", profile.person.birthDate],
    ["person.mobile", profile.person.mobile],
    ["person.email", profile.person.email],
    ["person.addressHome", profile.person.addressHome],
    ["work.company", profile.work.company],
    ["work.position", profile.work.position],
  ];
  profile.missing = required.filter(([, value]) => !value).map(([key]) => key);
  return profile;
}

function analyzeTemplateMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/).map((line) => normalize(line));
  const tables = parseTables(markdown);
  const template = {
    title: "",
    agency: "",
    projectName: "",
    recruitFields: [],
    deadline: "",
    submitEmail: "",
    contact: "",
    requiredDocuments: [],
    forms: [],
    fields: [],
    tables: [],
  };

  template.title =
    lines.find((line) => /공개모집 공고|등록 신청서|이력서/.test(line) && !line.startsWith("#")) || "HWP 양식";
  const agencyLine = lines.find((line) => {
    const tight = compact(line);
    return /군수|시장|구청장|공사|공단/.test(tight) && line.length < 80 && !line.includes("귀하");
  });
  template.agency = agencyLine ? agencyLine.replace(/\*/g, "").replace(/\s+/g, "").trim() : "";
  template.projectName = lines.find((line) => /대상사업|정비사업|용역/.test(line) && line.length < 120) || "";

  const fieldLine = lines.find((line) => line.includes("모집분야")) || "";
  const fieldMatch = fieldLine.match(/모집분야\s*:\s*(.+)$/);
  const rawFields = fieldMatch ? fieldMatch[1] : fieldLine;
  template.recruitFields = Array.from(
    new Set((rawFields.match(/[가-힣]+/g) || []).filter((word) => !["모집분야", "분야", "전문가", "명"].includes(word)))
  ).slice(0, 8);

  const deadlineLine = lines.find((line) => /접수기간|모집기간/.test(line)) || "";
  template.deadline = deadlineLine.replace(/\*/g, "");
  const emailMatch = markdown.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  template.submitEmail = emailMatch ? emailMatch[0] : "";
  const contactLine = lines.find((line) => /☎|문의처|문 의 처|연락처/.test(line)) || "";
  template.contact = contactLine.replace(/\*/g, "");

  const docsStart = lines.findIndex((line) => line.includes("제출서류"));
  if (docsStart >= 0) {
    for (const line of lines.slice(docsStart + 1)) {
      if (/^\*?\*?7\./.test(line) || line.includes("평가위원 선정")) break;
      if (/^[가-힣]\.|^-/.test(line) || /신청서|증명서|자격증|서약서|동의서/.test(line)) {
        const doc = line.replace(/\*/g, "").trim();
        if (doc) template.requiredDocuments.push(doc);
      }
    }
  }

  const formRegex = /\[(붙임|별지)\s*(\d+)\]/g;
  let match;
  while ((match = formRegex.exec(markdown))) {
    const rest = markdown.slice(match.index).split(/\r?\n/).map((line) => normalize(line));
    const title = rest.slice(1).find((line) => line && !line.startsWith("|") && !line.startsWith("---")) || `${match[1]} ${match[2]}`;
    template.forms.push({ id: `${match[1]}-${match[2]}`, title });
  }

  template.tables = tables.map((table, index) => ({
    id: `table_${index + 1}`,
    rowCount: table.length,
    headers: table[0] || [],
  }));

  const fieldDefs = [
    ["nameKo", "성명", "person.nameKo", "text"],
    ["birthDate", "생년월일", "person.birthDate", "date"],
    ["recruitField", "모집분야", "application.recruitField", "choice"],
    ["addressHome", "자택 주소", "person.addressHome", "text"],
    ["phoneHome", "자택 전화번호", "person.phoneHome", "text"],
    ["mobile", "휴대폰", "person.mobile", "text"],
    ["workCompany", "직장명", "work.company", "text"],
    ["workPosition", "직위", "work.position", "text"],
    ["workAddress", "직장 주소", "work.address", "text"],
    ["workPhone", "직장 전화번호", "work.phone", "text"],
    ["workFax", "팩스번호", "work.fax", "text"],
    ["email", "이메일주소", "person.email", "text"],
    ["education", "학력사항", "education", "table"],
    ["careers", "경력사항", "careers", "table"],
    ["licenses", "자격증 보유현황", "licenses", "table"],
    ["publications", "저서 및 논문", "publications", "longtext"],
    ["etc", "기타사항", "etc", "longtext"],
    ["securityPledge", "보안서약서 서약자", "pledge.signer", "text"],
    ["privacyAgreement", "개인정보 수집·이용 동의", "privacy.agree", "checkbox"],
  ];
  const compactMarkdown = compact(markdown);
  template.fields = fieldDefs
    .filter(([id, label]) => compactMarkdown.includes(compact(label)) || ["securityPledge", "privacyAgreement"].includes(id))
    .map(([id, label, profileField, type]) => ({ id, label, profileField, type }));

  return template;
}

function chooseRecruitField(profile, template) {
  const options = template.recruitFields || [];
  if (!options.length) return "";
  const haystack = compact(
    [
      ...(profile.licenses || []).map((item) => item.name),
      ...(profile.careers || []).map((item) => `${item.organization} ${item.duty}`),
      ...(profile.committees || []).map((item) => item.content),
      ...(profile.projects || []).map((item) => item.content),
    ].join(" ")
  );
  const water = options.find((option) => /수자원|상하수도|수도/.test(option) && /수자원|수도|댐|홍수|방재/.test(haystack));
  return water || options[0];
}

function confidence(value, defaultScore = 0.9) {
  if (Array.isArray(value)) return value.length ? defaultScore : 0.2;
  return cleanValue(value) ? defaultScore : 0.2;
}

function buildDraftValues(profile, template) {
  const recruitField = chooseRecruitField(profile, template);
  const coreCareers = (profile.careers || []).filter((item) =>
    /현재|수자원공사|이산/.test(`${item.period} ${item.organization}`)
  );
  const committeeCareers = (profile.committees || [])
    .filter((item) => /위원|심의|겸임교수/.test(item.content))
    .filter((item) => !/표창|수상|유공/.test(item.content))
    .sort((a, b) => {
      const score = (item) =>
        (/국토교통부|행정안전부|건설사고|심의위원/.test(item.content) ? 2 : 0) +
        (/현재|위원/.test(item.content) ? 1 : 0);
      return score(b) - score(a);
    });
  const selectedCareers = [...coreCareers, ...committeeCareers].slice(0, 4);

  const values = [
    ["nameKo", "성명", "text", "person.nameKo", profile.person?.nameKo || "", 0.98],
    ["birthDate", "생년월일", "date", "person.birthDate", profile.person?.birthDate || "", 0.95],
    ["recruitField", "모집분야", "choice", "application.recruitField", recruitField, 0.74],
    ["addressHome", "자택 주소", "text", "person.addressHome", profile.person?.addressHome || "", 0.94],
    ["mobile", "휴대폰", "text", "person.mobile", profile.person?.mobile || "", 0.98],
    ["email", "이메일주소", "text", "person.email", profile.person?.email || "", 0.98],
    ["workCompany", "직장명", "text", "work.company", profile.work?.company || "", 0.84],
    ["workPosition", "직위", "text", "work.position", profile.work?.position || "", 0.84],
  ].map(([id, label, type, profileField, value, score]) => ({
    id,
    label,
    type,
    profileField,
    value,
    confidence: confidence(value, score),
    status: value && score >= 0.9 ? "confirmed" : "needs_review",
    options: id === "recruitField" ? template.recruitFields || [] : undefined,
  }));

  values.push(
    {
      id: "education",
      label: "학력사항",
      type: "table",
      profileField: "education",
      value: (profile.education || []).slice(0, 4),
      confidence: confidence(profile.education, 0.9),
      status: "confirmed",
    },
    {
      id: "careers",
      label: "경력사항",
      type: "table",
      profileField: "careers",
      value: selectedCareers,
      confidence: confidence(selectedCareers, 0.78),
      status: "needs_review",
    },
    {
      id: "licenses",
      label: "자격증 보유현황",
      type: "table",
      profileField: "licenses",
      value: (profile.licenses || []).slice(0, 3),
      confidence: confidence(profile.licenses, 0.94),
      status: "confirmed",
    },
    {
      id: "privacyAgreement",
      label: "개인정보 수집·이용 동의",
      type: "checkbox",
      profileField: "privacy.agree",
      value: true,
      confidence: 0.7,
      status: "needs_review",
      note: "법적 동의 항목은 사용자가 직접 확인해야 합니다.",
    }
  );

  return {
    id: `draft_${Date.now()}`,
    templateTitle: template.title,
    agency: template.agency,
    projectName: template.projectName,
    generatedAt: new Date().toISOString(),
    values,
    warnings: values
      .filter((item) => item.status === "needs_review" || item.confidence < 0.8)
      .map((item) => `${item.label}: 확인 필요`),
    requiredDocuments: template.requiredDocuments || [],
  };
}

module.exports = {
  extractProfileFromMarkdown,
  analyzeTemplateMarkdown,
  buildDraftValues,
  parseTables,
};
