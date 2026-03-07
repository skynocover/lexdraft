## ADDED Requirements

### Requirement: 證據方法從 exhibits 表程式化生成

Pipeline SHALL 從 `exhibits` 表查詢該案件的所有證物，按 number 排序，格式化為證據方法段落。

格式：`{prefix}{中文數字}　{description}　　{doc_type}`

#### Scenario: 有 3 筆 exhibits
- **WHEN** 案件有 exhibits: [{prefix:"甲證", number:1, description:"房屋租賃契約書", doc_type:"影本"}, {prefix:"甲證", number:2, description:"入住點交紀錄表", doc_type:"影本"}, {prefix:"甲證", number:3, description:"退租點交紀錄表", doc_type:"影本"}]
- **THEN** 輸出段落為：
  ```
  甲證一　房屋租賃契約書　　影本
  甲證二　入住點交紀錄表　　影本
  甲證三　退租點交紀錄表　　影本
  ```

#### Scenario: 無 exhibits
- **WHEN** 案件無 exhibits 記錄
- **THEN** 輸出空段落或不產生證據方法段落

#### Scenario: 混合甲證乙證
- **WHEN** 案件有甲證和乙證
- **THEN** 先列甲證、再列乙證，各自按 number 排序
